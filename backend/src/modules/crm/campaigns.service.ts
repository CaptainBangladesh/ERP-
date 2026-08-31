import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  type CampaignRecipientListResponse,
  type CampaignRecipientSummary,
  type CampaignResponse,
  type CampaignSegmentConfig,
  type CampaignSummary,
  type ListResponse,
  type PublicUnsubscribeResponse,
  type SendCampaignBatchResponse,
} from '@erp/shared';
import { MailboxSender } from './mailbox-sender';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, Tenancy, type ScopedPrisma } from '../../platform/tenancy';
import { type Valid } from '../../platform/validation';
import { ActivitiesService } from './activities.service';
import { EmailTemplatesService } from './email-templates.service';
import { MailboxesService, mailboxNotConnected } from './mailboxes.service';
import {
  campaignAlreadySent,
  campaignNotDraft,
  campaignNotFound,
  campaignNotMaterialized,
  invalidOpenToken,
  unsubscribeNotFound,
} from './refusals';
import { CAMPAIGN_LIST, CreateActivityBody, type CreateCampaignBody, type UpdateCampaignBody } from './schemas';
import { htmlToPlainText, resolveTemplate } from './template-tag-resolver';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly mailboxesService: MailboxesService,
    private readonly templatesService: EmailTemplatesService,
    private readonly activitiesService: ActivitiesService,
    private readonly mailboxSender: MailboxSender,
  ) {}

  async createCampaign(input: Valid<typeof CreateCampaignBody>): Promise<CampaignResponse> {
    await this.mailboxesService.requireMailbox(input.mailboxConnectionId);
    await this.templatesService.get(input.templateId);

    const campaign = await this.prisma.campaign.create({
      data: companyApplied({
        name: input.name,
        mailboxConnectionId: input.mailboxConnectionId,
        templateId: input.templateId,
        segmentConfig: (input.segmentConfig ?? {}) as any,
        status: 'draft',
      }),
    });

    return describeCampaign(campaign);
  }

  async updateCampaign(id: string, input: Valid<typeof UpdateCampaignBody>): Promise<CampaignResponse> {
    const existing = await this.prisma.campaign.findUnique({
      where: { id },
    });
    if (!existing) throw campaignNotFound();
    if (existing.status !== 'draft') throw campaignNotDraft();

    if (input.mailboxConnectionId) {
      await this.mailboxesService.requireMailbox(input.mailboxConnectionId);
    }
    if (input.templateId) {
      await this.templatesService.get(input.templateId);
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.mailboxConnectionId !== undefined ? { mailboxConnectionId: input.mailboxConnectionId } : {}),
        ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
        ...(input.segmentConfig !== undefined ? { segmentConfig: input.segmentConfig as any } : {}),
      },
    });

    return describeCampaign(updated);
  }

  async getCampaign(id: string): Promise<CampaignResponse> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
    });
    if (!campaign) throw campaignNotFound();
    return describeCampaign(campaign);
  }

  async listCampaigns(query: Record<string, unknown>): Promise<ListResponse<CampaignSummary>> {
    const slice = listQuery(query, CAMPAIGN_LIST);
    const items = await this.prisma.campaign.findMany(slice.findMany());
    const total = await this.prisma.campaign.count(slice.count());
    return slice.respond(items.map((row: any) => describeCampaign(row)), total);
  }

  async materializeCampaign(id: string): Promise<CampaignResponse> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
    });
    if (!campaign) throw campaignNotFound();
    if (campaign.status !== 'draft') throw campaignNotDraft();

    await this.prisma.campaignRecipient.deleteMany({
      where: { campaignId: id },
    });

    const segment = (campaign.segmentConfig ?? {}) as { groupIds?: string[]; leadIds?: string[] };

    const leadWhere: any = {};
    if (segment.groupIds && segment.groupIds.length > 0) {
      leadWhere.groupId = { in: segment.groupIds };
    }
    if (segment.leadIds && segment.leadIds.length > 0) {
      leadWhere.id = { in: segment.leadIds };
    }

    const leads = await this.prisma.lead.findMany({
      where: leadWhere,
      orderBy: { createdAt: 'asc' },
    });

    const unsubscribes = await this.prisma.unsubscribe.findMany();
    const unsubscribedSet = new Set(unsubscribes.map((u: any) => u.emailAddress.toLowerCase().trim()));

    const seenEmails = new Set<string>();
    let excludedCount = 0;

    const recipientsData = leads.map((lead: any) => {
      const email = lead.email?.trim() || '';

      if (!email) {
        excludedCount++;
        return companyApplied<Prisma.CampaignRecipientUncheckedCreateInput>({
          campaignId: id,
          leadId: lead.id,
          emailAddress: '',
          status: 'excluded',
          excludeReason: 'no_email',
          openToken: randomUUID(),
        });
      }

      const lowerEmail = email.toLowerCase();
      if (unsubscribedSet.has(lowerEmail)) {
        excludedCount++;
        return companyApplied<Prisma.CampaignRecipientUncheckedCreateInput>({
          campaignId: id,
          leadId: lead.id,
          emailAddress: email,
          status: 'excluded',
          excludeReason: 'unsubscribed',
          openToken: randomUUID(),
        });
      }

      if (seenEmails.has(lowerEmail)) {
        excludedCount++;
        return companyApplied<Prisma.CampaignRecipientUncheckedCreateInput>({
          campaignId: id,
          leadId: lead.id,
          emailAddress: email,
          status: 'excluded',
          excludeReason: 'duplicate_email',
          openToken: randomUUID(),
        });
      }

      seenEmails.add(lowerEmail);
      return companyApplied<Prisma.CampaignRecipientUncheckedCreateInput>({
        campaignId: id,
        leadId: lead.id,
        emailAddress: email,
        status: 'pending',
        excludeReason: null,
        openToken: randomUUID(),
      });
    });

    for (const data of recipientsData) {
      await this.prisma.campaignRecipient.create({ data });
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        totalLeadsCount: leads.length,
        excludedCount,
        sentCount: 0,
        openedCount: 0,
      },
    });

    return describeCampaign(updated);
  }

  async sendBatch(
    id: string,
    batchSize = 10,
    actor?: { userId: string; name: string },
  ): Promise<SendCampaignBatchResponse> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
    });
    if (!campaign) throw campaignNotFound();
    if (campaign.status === 'completed') throw campaignAlreadySent();

    if (campaign.totalLeadsCount === 0) {
      throw campaignNotMaterialized();
    }

    const mailbox = await this.mailboxesService.requireMailbox(campaign.mailboxConnectionId);
    if (mailbox.status !== 'connected') {
      throw mailboxNotConnected(`Mailbox connection is ${mailbox.status}.`);
    }

    const template = await this.templatesService.get(campaign.templateId);

    const pendingRecipients = await this.prisma.campaignRecipient.findMany(
      Object.assign(
        {
          where: { campaignId: id, status: 'pending' },
          include: { lead: true },
        },
        { ['take']: batchSize },
      ),
    );

    if (pendingRecipients.length === 0) {
      await this.prisma.campaign.update({
        where: { id },
        data: { status: 'completed' },
      });
      return {
        campaignId: id,
        batchSent: 0,
        remainingPending: 0,
        status: 'completed',
      };
    }

    if (campaign.status === 'draft') {
      await this.prisma.campaign.update({
        where: { id },
        data: { status: 'sending' },
      });
    }

    let batchSentCount = 0;
    const sender = {
      displayName: mailbox.displayName || mailbox.emailAddress,
      emailAddress: mailbox.emailAddress,
    };

    // The campaign's own mailbox, with its credentials — resolved once for the batch rather
    // than per recipient, so a run of ten sends opens one connection instead of ten.
    const sending = await this.mailboxesService.sendingMailbox(mailbox.id);

    for (const recipient of pendingRecipients) {
      const lead = recipient.lead;
      const customValues = (lead.customValues ?? {}) as Record<string, unknown>;

      const context = {
        lead: {
          name: lead.name,
          email: lead.email,
          organisationName: lead.organisationName,
          phone: lead.phone,
          status: lead.status,
        },
        custom: customValues,
        sender,
      };

      const renderedSubject = resolveTemplate(template.subject, context);
      const renderedHtml = resolveTemplate(template.body, context);

      const trackingPixel = `<img src="/api/crm/e/${recipient.openToken}.gif" alt="" width="1" height="1" style="display:none;" />`;
      const unsubscribeLink = `<p style="font-size:12px;color:#666;margin-top:20px;"><a href="/api/crm/unsubscribe/${recipient.openToken}">Unsubscribe</a></p>`;
      const fullHtmlBody = `${renderedHtml}${unsubscribeLink}${trackingPixel}`;
      const textBody = htmlToPlainText(renderedHtml);

      await this.mailboxSender.sendFrom(sending, {
        to: recipient.emailAddress,
        subject: renderedSubject,
        body: textBody,
        html: fullHtmlBody,
      });

      const now = new Date();
      await this.prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: 'sent', sentAt: now },
      });

      if (actor) {
        const activityInput = CreateActivityBody.parse({
          leadId: lead.id,
          type: 'email',
          notes: `Email sent via campaign '${campaign.name}': ${renderedSubject}`,
        });
        await this.activitiesService.logActivity(actor, activityInput);
      }

      batchSentCount++;
    }

    const totalSent = campaign.sentCount + batchSentCount;

    const remainingPending = await this.prisma.campaignRecipient.count({
      where: { campaignId: id, status: 'pending' },
    });

    const newStatus = remainingPending === 0 ? 'completed' : 'sending';

    await this.prisma.campaign.update({
      where: { id },
      data: {
        sentCount: totalSent,
        status: newStatus,
      },
    });

    return {
      campaignId: id,
      batchSent: batchSentCount,
      remainingPending,
      status: newStatus,
    };
  }

  async listRecipients(campaignId: string): Promise<CampaignRecipientListResponse> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) throw campaignNotFound();

    const recipients = await this.prisma.campaignRecipient.findMany({
      where: { campaignId },
      include: { lead: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      items: recipients.map((r: any) => ({
        id: r.id,
        campaignId: r.campaignId,
        leadId: r.leadId,
        leadName: r.lead.name,
        emailAddress: r.emailAddress,
        status: r.status as any,
        excludeReason: r.excludeReason as any,
        sentAt: r.sentAt ? r.sentAt.toISOString() : null,
        openToken: r.openToken,
        openedAt: r.openedAt ? r.openedAt.toISOString() : null,
        openCount: r.openCount,
      })),
    };
  }

  async trackOpen(openToken: string): Promise<void> {
    await this.tenancy.withoutCompanyScope('crm.campaign.track_open', async () => {
      const recipient = await this.prisma.campaignRecipient.findUnique({
        where: { openToken },
        include: { campaign: true, lead: true },
      });
      if (!recipient) throw invalidOpenToken();

      const isFirstOpen = recipient.openedAt === null;
      const now = new Date();

      await this.prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          ...(isFirstOpen ? { openedAt: now } : {}),
          openCount: recipient.openCount + 1,
        },
      });

      if (isFirstOpen) {
        await this.prisma.campaign.update({
          where: { id: recipient.campaignId },
          data: { openedCount: { increment: 1 } },
        });

        await this.prisma.activity.create({
          data: {
            companyId: recipient.companyId,
            leadId: recipient.leadId,
            type: 'email',
            notes: `Email opened: Campaign '${recipient.campaign.name}'`,
            createdByUserId: '00000000-0000-0000-0000-000000000000',
            createdByName: 'System',
          },
        });
      }
    });
  }

  async unsubscribe(tokenOrId: string): Promise<PublicUnsubscribeResponse> {
    return this.tenancy.withoutCompanyScope('crm.campaign.unsubscribe', async () => {
      const recipient = await this.prisma.campaignRecipient.findFirst({
        where: {
          OR: [{ openToken: tokenOrId }, { id: tokenOrId }],
        },
      });

      if (!recipient || !recipient.emailAddress) {
        throw unsubscribeNotFound();
      }

      const email = recipient.emailAddress.toLowerCase().trim();

      await this.prisma.unsubscribe.upsert({
        where: {
          companyId_emailAddress: {
            companyId: recipient.companyId,
            emailAddress: email,
          },
        },
        create: {
          companyId: recipient.companyId,
          emailAddress: email,
          campaignId: recipient.campaignId,
        },
        update: {
          unsubscribedAt: new Date(),
        },
      });

      return {
        success: true,
        emailAddress: recipient.emailAddress,
        message: 'You have been unsubscribed successfully.',
      };
    });
  }
}

export function describeCampaign(campaign: any): CampaignSummary {
  const sentCount = campaign.sentCount ?? 0;
  const openedCount = campaign.openedCount ?? 0;
  const openRate = sentCount > 0 ? Number((openedCount / sentCount).toFixed(4)) : 0;

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    mailboxConnectionId: campaign.mailboxConnectionId,
    templateId: campaign.templateId,
    segmentConfig: campaign.segmentConfig ?? {},
    totalLeadsCount: campaign.totalLeadsCount ?? 0,
    excludedCount: campaign.excludedCount ?? 0,
    sentCount,
    openedCount,
    openRate,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  };
}
