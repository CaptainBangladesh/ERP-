import { Module } from '@nestjs/common';
import { PartiesModule } from '../parties';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { StagesController } from './stages.controller';
import { StagesService } from './stages.service';
import { WorkflowRulesController } from './workflow-rules.controller';
import { WorkflowRulesService } from './workflow-rules.service';
import { LeadGroupsController } from './lead-groups.controller';
import { LeadGroupsService } from './lead-groups.service';
import { LeadSourcesController } from './lead-sources.controller';
import { LeadSourcesService } from './lead-sources.service';
import { LeadFieldsController } from './lead-fields.controller';
import { LeadFieldsService } from './lead-fields.service';
import { LeadStatusLabelsController } from './lead-status-labels.controller';
import { LeadStatusLabelsService } from './lead-status-labels.service';
import { MailboxesController } from './mailboxes.controller';
import { MailboxesService } from './mailboxes.service';
import { GoogleMailboxOAuth, MailboxOAuth, StubMailboxOAuth } from './mailbox-oauth';
import { LiveMailboxSender, MailboxSender, RecordingMailboxSender } from './mailbox-sender';
import { EmailTemplatesController } from './email-templates.controller';
import { EmailTemplatesService } from './email-templates.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CaptureSourcesController } from './capture-sources.controller';
import { CaptureSourcesService } from './capture-sources.service';
import { LeadImportsController } from './lead-imports.controller';
import { LeadImportsService } from './lead-imports.service';
import { LeadOutreachService } from './lead-outreach.service';

import { PublicCaptureController } from './public-capture.controller';
import { PublicCampaignsController } from './public-campaigns.controller';

@Module({
  imports: [PartiesModule],
  controllers: [
    DashboardController,
    LeadsController,
    StagesController,
    DealsController,
    ActivitiesController,
    WorkflowRulesController,
    LeadGroupsController,
    LeadSourcesController,
    LeadFieldsController,
    LeadStatusLabelsController,
    MailboxesController,
    EmailTemplatesController,
    CampaignsController,
    CaptureSourcesController,
    LeadImportsController,
    PublicCaptureController,
    PublicCampaignsController,
  ],
  providers: [
    DashboardService,
    LeadsService,
    StagesService,
    DealsService,
    ActivitiesService,
    WorkflowRulesService,
    LeadGroupsService,
    LeadSourcesService,
    LeadFieldsService,
    LeadStatusLabelsService,
    MailboxesService,
    GoogleMailboxOAuth,
    StubMailboxOAuth,
    {
      // Bound on the test environment alone. Not on whether credentials happen to be set:
      // a developer without them gets the same refusal production would give, rather than a
      // mailbox that looks connected and belongs to nobody. See `mailbox-oauth.ts`.
      provide: MailboxOAuth,
      useFactory: (google: GoogleMailboxOAuth, stub: StubMailboxOAuth) =>
        process.env.NODE_ENV === 'test' ? stub : google,
      inject: [GoogleMailboxOAuth, StubMailboxOAuth],
    },
    LiveMailboxSender,
    RecordingMailboxSender,
    {
      // Same rule as the exchange above: the real sender everywhere but the suite, which has
      // no mail server to reach and reads what was sent out of `DevMailer`.
      provide: MailboxSender,
      useFactory: (live: LiveMailboxSender, recording: RecordingMailboxSender) =>
        process.env.NODE_ENV === 'test' ? recording : live,
      inject: [LiveMailboxSender, RecordingMailboxSender],
    },
    EmailTemplatesService,
    CampaignsService,
    CaptureSourcesService,
    LeadImportsService,
    LeadOutreachService,
  ],
})
export class CrmModule {}
