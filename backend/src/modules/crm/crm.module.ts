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

@Module({
  imports: [PartiesModule],
  controllers: [
    DashboardController,
    LeadsController,
    StagesController,
    DealsController,
    ActivitiesController,
    WorkflowRulesController,
  ],
  providers: [
    DashboardService,
    LeadsService,
    StagesService,
    DealsService,
    ActivitiesService,
    WorkflowRulesService,
  ],
})
export class CrmModule {}

