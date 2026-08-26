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
    EmailTemplatesService,
    CampaignsService,
    CaptureSourcesService,
    LeadImportsService,
    LeadOutreachService,
  ],
})
export class CrmModule {}
