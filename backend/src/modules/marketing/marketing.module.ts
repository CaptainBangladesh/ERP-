import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { CrmModule } from '../crm';
import { BioPageCspMiddleware } from './bio-page-csp.middleware';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { CryptoService } from './crypto.service';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';
import { SocialAccountsController } from './social-accounts.controller';
import { SocialAccountsService } from './social-accounts.service';
import { JobsController } from './jobs.controller';
import { JOB_QUEUE_TOKEN } from './job-queue.interface';
import { JobQueueWorkerService } from './job-queue-worker.service';
import { PostgresJobQueueService } from './postgres-job-queue.service';
import { LiveSocialOAuth, SocialOAuth, StubSocialOAuth } from './social-oauth';
import { PostsController } from './posts.controller';
import { AutolistsController } from './autolists.controller';
import { SocialPublisherService } from './social-publisher.service';
import { AutolistsService } from './autolists.service';
import { MetaNetworkAdapter } from './adapters/meta.adapter';
import { LinkedInNetworkAdapter } from './adapters/linkedin.adapter';
import { XNetworkAdapter } from './adapters/x.adapter';
import { TikTokNetworkAdapter } from './adapters/tiktok.adapter';
import { StubSocialNetworkAdapter } from './adapters/stub.adapter';
import { SocialAdapterResolver } from './adapters/social-adapter.resolver';
import { UtmService } from './utm.service';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { SmartLinksService } from './smart-links.service';
import { SmartLinksController } from './smart-links.controller';
import { PublicSmartLinksController } from './public-smart-links.controller';
import { AdSyncService } from './ad-sync.service';
import { AdSyncController } from './ad-sync.controller';
import { CrmBridgeService } from './crm-bridge.service';
import { FormsService } from './forms.service';
import { FormsController } from './forms.controller';
import { PublicFormsController } from './public-forms.controller';
import { NurtureSequencesService } from './nurture-sequences.service';
import { NurtureSequencesController } from './nurture-sequences.controller';
import { AdWebhooksController } from './ad-webhooks.controller';
import { InboxService } from './inbox.service';
import { DmFlowsService } from './dm-flows.service';
import { InboxController } from './inbox.controller';
import { DmFlowsController } from './dm-flows.controller';
import { SocialInboxWebhooksController } from './social-inbox-webhooks.controller';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { PublicTrackingController } from './public-tracking.controller';
import { RetentionService } from './retention.service';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';
import { SnippetsService } from './snippets.service';
import { SnippetsController } from './snippets.controller';

/**
 * Marketing.
 *
 * Exports nothing yet to other modules. When another module needs something from this one,
 * declare an abstract class in 'index.ts', bind the service to it here with 'useExisting',
 * and export that.
 *
 * Imports 'CrmModule' for one thing only: 'CrmLeadIntake', which is what arrives — not
 * 'LeadsService'. Every inbound lead this module captures is written through those four
 * methods, so there is no path from here to a CRM table.
 */
@Module({
  imports: [CrmModule],
  controllers: [
    MarketingController,
    BrandsController,
    SocialAccountsController,
    JobsController,
    PostsController,
    AutolistsController,
    CampaignsController,
    SmartLinksController,
    PublicSmartLinksController,
    AdSyncController,
    FormsController,
    PublicFormsController,
    NurtureSequencesController,
    AdWebhooksController,
    InboxController,
    DmFlowsController,
    SocialInboxWebhooksController,
    TrackingController,
    PublicTrackingController,
    InsightsController,
    SnippetsController,
  ],
  providers: [
    MarketingService,
    CryptoService,
    BrandsService,
    SocialAccountsService,
    PostgresJobQueueService,
    JobQueueWorkerService,
    {
      provide: JOB_QUEUE_TOKEN,
      useExisting: PostgresJobQueueService,
    },
    LiveSocialOAuth,
    StubSocialOAuth,
    {
      provide: SocialOAuth,
      useFactory: (live: LiveSocialOAuth, stub: StubSocialOAuth) =>
        process.env.NODE_ENV === 'test' ? stub : live,
      inject: [LiveSocialOAuth, StubSocialOAuth],
    },
    MetaNetworkAdapter,
    LinkedInNetworkAdapter,
    XNetworkAdapter,
    TikTokNetworkAdapter,
    StubSocialNetworkAdapter,
    SocialAdapterResolver,
    SocialPublisherService,
    AutolistsService,
    UtmService,
    CampaignsService,
    SmartLinksService,
    AdSyncService,
    CrmBridgeService,
    FormsService,
    NurtureSequencesService,
    InboxService,
    DmFlowsService,
    TrackingService,
    RetentionService,
    InsightsService,
    SnippetsService,
  ],
  exports: [
    CryptoService,
    BrandsService,
    SocialAccountsService,
    PostgresJobQueueService,
    JOB_QUEUE_TOKEN,
    SocialPublisherService,
    AutolistsService,
    SocialAdapterResolver,
    UtmService,
    CampaignsService,
    SmartLinksService,
    AdSyncService,
    CrmBridgeService,
    FormsService,
    NurtureSequencesService,
    InboxService,
    DmFlowsService,
    TrackingService,
    InsightsService,
    SnippetsService,
  ],
})
export class MarketingModule implements NestModule {
  /**
   * Every public bio-page response carries its nonce CSP, including ones nobody has written yet.
   * Putting it here rather than on each handler means a new route under '/b' cannot be added
   * without the policy.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BioPageCspMiddleware).forRoutes('b');
  }
}

