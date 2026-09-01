import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  LEAD_EMAIL_PATHS,
  type SendLeadEmailRequest,
  type SendLeadEmailResponse,
} from '@erp/shared';
import { companyApplied, InjectPrisma, Tenancy, type ScopedPrisma } from '../../platform/tenancy';
import { SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME, auditNotes } from './audit-events';
import { MailboxSender } from './mailbox-sender';
import { ActivitiesService } from './activities.service';
import { EmailTemplatesService } from './email-templates.service';
import { LeadsService } from './leads.service';
import { MailboxesService, mailboxNotConnected } from './mailboxes.service';
import {
  htmlToPlainText,
  resolveTemplate,
} from './template-tag-resolver';

@Injectable()
export class LeadOutreachService {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly mailboxesService: MailboxesService,
    private readonly templatesService: EmailTemplatesService,
    private readonly activitiesService: ActivitiesService,
    private readonly mailboxSender: MailboxSender,
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
  ) {}

  async sendOneOnOneEmail(
    leadId: string,
    req: SendLeadEmailRequest,
    actor: { userId: string; name: string },
  ): Promise<SendLeadEmailResponse> {
    const lead = await this.leadsService.leadDetail(leadId);
    const mailbox = await this.mailboxesService.requireMailbox(req.mailboxConnectionId);

    if (mailbox.status !== 'connected') {
      throw mailboxNotConnected(`Mailbox connection is ${mailbox.status}. Please reconnect.`);
    }

    let templateSubject = req.subject || '';
    let templateHtml = req.htmlBody || '';

    if (req.templateId) {
      const template = await this.templatesService.get(req.templateId);
      templateSubject = template.subject;
      templateHtml = template.body;
    }

    const context = {
      lead: {
        name: lead.name,
        email: lead.email,
        organisationName: lead.organisationName,
        phone: lead.phone,
        status: lead.status,
      },
      custom: lead.customValues || {},
      sender: {
        displayName: mailbox.displayName,
        emailAddress: mailbox.emailAddress,
      },
    };

    const resolvedSubject = resolveTemplate(templateSubject, context);
    const resolvedHtml = resolveTemplate(templateHtml, context);
    const resolvedText = htmlToPlainText(resolvedHtml);

    const recipientEmail = lead.email || 'lead@example.com';

    /**
     * The send is recorded before it leaves, because the pixel the mail carries has to point
     * at a token that already exists — a mail client can fetch it within seconds of delivery,
     * and a pixel referencing a row written afterwards would report nothing.
     */
    const openToken = randomUUID();
    const trackingPixel =
      `<img src="${LEAD_EMAIL_PATHS.publicOpenPixel(openToken)}" alt="" width="1" height="1" ` +
      `style="display:none;" />`;

    // Through the mailbox the user picked, not the deployment's own mailer: this is mail
    // from a person, and it has to leave from their address so the reply comes back to them.
    const sending = await this.mailboxesService.sendingMailbox(req.mailboxConnectionId);
    await this.mailboxSender.sendFrom(sending, {
      to: recipientEmail,
      subject: resolvedSubject,
      body: resolvedText,
      html: `${resolvedHtml}${trackingPixel}`,
    });

    const activity = await this.activitiesService.logActivity(actor, {
      leadId,
      dealId: undefined,
      partyId: undefined,
      type: 'email',
      notes: `Email sent: ${resolvedSubject}\n\n${resolvedText.substring(0, 200)}`,
      occurredAt: new Date(),
      dueAt: undefined,
    });

    await this.prisma.leadEmailSend.create({
      data: companyApplied<Prisma.LeadEmailSendUncheckedCreateInput>({
        leadId,
        activityId: activity.id,
        sentByUserId: actor.userId,
        subject: resolvedSubject,
        openToken,
      }),
    });

    return {
      success: true,
      activityId: activity.id,
    };
  }

  /**
   * A tracking pixel was fetched.
   *
   * Unauthenticated and outside any company: the request comes from the recipient's mail
   * client, which holds no session, so the token is the only thing that says which company's
   * send this is. That is why the lookup suspends scoping and everything written afterwards
   * names the company the token resolved to.
   *
   * Only the *first* fetch notifies. Apple Mail Privacy Protection pre-fetches images and
   * proxies re-fetch them, so a notification per fetch would be noise rather than news — and
   * the same logic is what keeps the Timeline to one `📬` entry with a count that climbs,
   * rather than an entry per fetch.
   */
  async trackOpen(openToken: string): Promise<void> {
    await this.tenancy.withoutCompanyScope('crm.lead_email.track_open', async () => {
      const send = await this.prisma.leadEmailSend.findUnique({ where: { openToken } });
      if (!send) return;

      const isFirstOpen = send.openedAt === null;
      const openCount = send.openCount + 1;

      await this.prisma.leadEmailSend.update({
        where: { id: send.id },
        data: { ...(isFirstOpen ? { openedAt: new Date() } : {}), openCount },
      });

      await this.tenancy.runInCompany({ companyId: send.companyId, grants: 'all' }, async () => {
        if (!isFirstOpen) {
          // One entry whose count climbs, not an entry per fetch — see `trackOpen`'s note.
          if (send.openActivityId) {
            await this.prisma.activity.updateMany({
              where: { id: send.openActivityId },
              data: { notes: auditNotes.emailOpened(send.subject, openCount) },
            });
          }
          return;
        }

        const entry = await this.prisma.activity.create({
          data: companyApplied<Prisma.ActivityUncheckedCreateInput>({
            type: 'email',
            notes: auditNotes.emailOpened(send.subject, openCount),
            leadId: send.leadId,
            createdByUserId: SYSTEM_ACTOR_ID,
            createdByName: SYSTEM_ACTOR_NAME,
          }),
        });

        await this.prisma.leadEmailSend.update({
          where: { id: send.id },
          data: { openActivityId: entry.id },
        });

        await this.prisma.notification.create({
          data: companyApplied<Prisma.NotificationUncheckedCreateInput>({
            userId: send.sentByUserId,
            title: 'Your email was probably opened',
            message: `“${send.subject}” looks to have been opened. Now is a good time to follow up.`,
            read: false,
          }),
        });
      });
    });
  }
}
