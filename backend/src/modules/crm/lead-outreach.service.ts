import { Injectable } from '@nestjs/common';
import {
  type SendLeadEmailRequest,
  type SendLeadEmailResponse,
} from '@erp/shared';
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

    // Through the mailbox the user picked, not the deployment's own mailer: this is mail
    // from a person, and it has to leave from their address so the reply comes back to them.
    const sending = await this.mailboxesService.sendingMailbox(req.mailboxConnectionId);
    await this.mailboxSender.sendFrom(sending, {
      to: recipientEmail,
      subject: resolvedSubject,
      body: resolvedText,
      html: resolvedHtml,
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

    return {
      success: true,
      activityId: activity.id,
    };
  }
}
