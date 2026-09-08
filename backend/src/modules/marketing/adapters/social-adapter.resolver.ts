import { Injectable } from '@nestjs/common';
import type { SocialPlatform } from '@erp/shared';
import type { ISocialNetworkAdapter } from './social-adapter.interface';
import { LinkedInNetworkAdapter } from './linkedin.adapter';
import { MetaNetworkAdapter } from './meta.adapter';
import { StubSocialNetworkAdapter } from './stub.adapter';
import { TikTokNetworkAdapter } from './tiktok.adapter';
import { XNetworkAdapter } from './x.adapter';

@Injectable()
export class SocialAdapterResolver {
  private readonly liveAdapters: ISocialNetworkAdapter[];

  constructor(
    private readonly metaAdapter: MetaNetworkAdapter,
    private readonly linkedInAdapter: LinkedInNetworkAdapter,
    private readonly xAdapter: XNetworkAdapter,
    private readonly tikTokAdapter: TikTokNetworkAdapter,
    private readonly stubAdapter: StubSocialNetworkAdapter,
  ) {
    this.liveAdapters = [
      this.metaAdapter,
      this.linkedInAdapter,
      this.xAdapter,
      this.tikTokAdapter,
    ];
  }

  getAdapter(platform: SocialPlatform): ISocialNetworkAdapter {
    const isTest = process.env.NODE_ENV === 'test';
    const isLiveDisabled = process.env.MARKETING_LIVE_ADAPTERS_ENABLED !== 'true';

    if (isTest || isLiveDisabled) {
      return this.stubAdapter;
    }

    const adapter = this.liveAdapters.find((a) => a.supports(platform));
    return adapter ?? this.stubAdapter;
  }

  getStub(): StubSocialNetworkAdapter {
    return this.stubAdapter;
  }
}
