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
import { AiController, AiKeysController } from './ai.controller';
import { AiAllowanceService } from './ai-allowance.service';
import { AiComposerService } from './ai-composer.service';
import { AiKeysService } from './ai-keys.service';
import { AiProvider, LiveAiProvider, StubAiProvider } from './ai-provider';
import {
  LiveOutboundFetchService,
  OutboundFetchService,
  StubOutboundFetchService,
} from './outbound-fetch.service';
import { ContentFeedsService } from './content-feeds.service';
import { ContentFeedsController } from './content-feeds.controller';
import { CompetitorsService } from './competitors.service';
import { CompetitorsController } from './competitors.controller';

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
    AiController,
    AiKeysController,
    ContentFeedsController,
    CompetitorsController,
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
    LiveAiProvider,
    StubAiProvider,
    {
      /**
       * The model, bound once (14a-bis). Tests get a provider that answers without a network,
       * which is what lets "refused before the API call" be asserted rather than asserted
       * about a mock somebody could forget to install.
       */
      provide: AiProvider,
      useFactory: (live: LiveAiProvider, stub: StubAiProvider) =>
        process.env.NODE_ENV === 'test' ? stub : live,
      inject: [LiveAiProvider, StubAiProvider],
    },
    AiAllowanceService,
    AiKeysService,
    AiComposerService,
    LiveOutboundFetchService,
    StubOutboundFetchService,
    {
      /**
       * The one way out of this module (14-17.0), bound once. Tests get a double that runs the
       * *same* address check and then serves canned bytes, so "a feed host resolving to a
       * private address is refused" is asserted against the guard's rule rather than against a
       * mock's manners.
       */
      provide: OutboundFetchService,
      useFactory: (live: LiveOutboundFetchService, stub: StubOutboundFetchService) =>
        process.env.NODE_ENV === 'test' ? stub : live,
      inject: [LiveOutboundFetchService, StubOutboundFetchService],
    },
    ContentFeedsService,
    CompetitorsService,
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
    AiAllowanceService,
    AiKeysService,
    AiComposerService,
    OutboundFetchService,
    ContentFeedsService,
    CompetitorsService,
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

