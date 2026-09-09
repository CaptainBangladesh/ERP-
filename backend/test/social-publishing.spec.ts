import { SocialPublisherService } from '../src/modules/marketing/social-publisher.service';
import { AutolistsService } from '../src/modules/marketing/autolists.service';
import { CryptoService } from '../src/modules/marketing/crypto.service';
import { SocialAdapterResolver } from '../src/modules/marketing/adapters/social-adapter.resolver';
import { MetaNetworkAdapter } from '../src/modules/marketing/adapters/meta.adapter';
import { LinkedInNetworkAdapter } from '../src/modules/marketing/adapters/linkedin.adapter';
import { XNetworkAdapter } from '../src/modules/marketing/adapters/x.adapter';
import { TikTokNetworkAdapter } from '../src/modules/marketing/adapters/tiktok.adapter';
import { StubSocialNetworkAdapter } from '../src/modules/marketing/adapters/stub.adapter';
import { PostgresJobQueueService } from '../src/modules/marketing/postgres-job-queue.service';
import { Tenancy } from '../src/platform/tenancy';
import { quotaLedgerDouble } from './harness/quota-ledger';

describe('Social Publishing Engine & Evergreen Autolists', () => {
  let mockPosts: any[];
  let mockAutolists: any[];
  let mockAutolistItems: any[];
  let mockBrands: any[];
  let mockSocialAccounts: any[];
  let mockJobs: any[];

  let mockPrisma: any;
  let tenancy: Tenancy;
  let cryptoService: CryptoService;
  let stubAdapter: StubSocialNetworkAdapter;
  let resolver: SocialAdapterResolver;
  let queueService: PostgresJobQueueService;
  let publisherService: SocialPublisherService;
  let autolistsService: AutolistsService;

  beforeEach(() => {
    mockPosts = [];
    mockAutolists = [];
    mockAutolistItems = [];
    mockBrands = [
      {
        id: 'brand-1',
        companyId: 'company-1',
        name: 'Acme Brand',
        slug: 'acme-brand',
        timezone: 'UTC',
        storageQuotaMb: 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockJobs = [];

    process.env.ENCRYPTION_SECRET = '01234567890123456789012345678901';
    cryptoService = new CryptoService();

    const encryptedToken = cryptoService.encrypt('secret-oauth-token-12345');

    mockSocialAccounts = [
      {
        id: 'acc-ig',
        companyId: 'company-1',
        brandId: 'brand-1',
        platform: 'instagram',
        accountName: 'Acme IG',
        platformAccountId: 'ig_123456',
        encryptedAccessToken: encryptedToken,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'acc-li',
        companyId: 'company-1',
        brandId: 'brand-1',
        platform: 'linkedin',
        accountName: 'Acme LinkedIn',
        platformAccountId: 'li_987654',
        encryptedAccessToken: encryptedToken,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'acc-x',
        companyId: 'company-1',
        brandId: 'brand-1',
        platform: 'x',
        accountName: 'Acme X',
        platformAccountId: 'x_112233',
        encryptedAccessToken: encryptedToken,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'acc-tt',
        companyId: 'company-1',
        brandId: 'brand-1',
        platform: 'tiktok',
        accountName: 'Acme TikTok',
        platformAccountId: 'tt_445566',
        encryptedAccessToken: encryptedToken,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    mockPrisma = {
      marketingBrand: {
        findUnique: jest.fn(async ({ where }: any) => {
          return mockBrands.find((b) => b.id === where.id) ?? null;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          return mockBrands.find((b) => b.id === where.id) ?? null;
        }),
      },
      socialAccount: {
        findFirst: jest.fn(async ({ where }: any) => {
          return mockSocialAccounts.find((a) => a.id === where.id && (!where.brandId || a.brandId === where.brandId)) ?? null;
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          return mockSocialAccounts.find((a) => a.id === where.id) ?? null;
        }),
      },
      // Read on every publish guard, not only by the benchmarking paths — the posts and the
      // competitor reads spend one window between them.
      socialQuotaLedger: quotaLedgerDouble(),
      scheduledPost: {
        // The quota query since ticket 11: published rows by publish time, plus failed rows
        // that reached the network. A stub that still filtered on `createdAt` would agree with
        // the bug rather than with the code.
        count: jest.fn().mockImplementation(({ where }: any) => {
          const spent = (p: any) => {
            if (where.socialAccountId && p.socialAccountId !== where.socialAccountId) return false;
            if (!where.OR) return true;
            return where.OR.some((clause: any) => {
              if (clause.status && p.status !== clause.status) return false;
              if (clause.publishedAt?.gte && !(p.publishedAt && p.publishedAt >= clause.publishedAt.gte)) {
                return false;
              }
              if (
                clause.networkAttemptedAt?.gte &&
                !(p.networkAttemptedAt && p.networkAttemptedAt >= clause.networkAttemptedAt.gte)
              ) {
                return false;
              }
              return true;
            });
          };
          return Promise.resolve(mockPosts.filter(spent).length);
        }),
        // The conditional claim the publisher makes before touching the network.
        updateMany: jest.fn(async ({ where, data }: any) => {
          const claimable = mockPosts.filter(
            (p: any) =>
              p.id === where.id && (!where.status?.in || where.status.in.includes(p.status)),
          );
          for (const post of claimable) Object.assign(post, data);
          return { count: claimable.length };
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `post-${mockPosts.length + 1}`,
            companyId: data.companyId ?? 'company-1',
            brandId: data.brandId,
            socialAccountId: data.socialAccountId,
            campaignId: data.campaignId ?? null,
            autolistItemId: data.autolistItemId ?? null,
            content: data.content,
            mediaUrls: data.mediaUrls ?? [],
            platformConfig: data.platformConfig ?? null,
            scheduledAt: data.scheduledAt,
            publishedAt: null,
            status: data.status ?? 'SCHEDULED',
            networkAttemptedAt: null,
            failureReason: null,
            externalPostId: null,
            metrics: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockPosts.push(row);
          const account = mockSocialAccounts.find((a) => a.id === row.socialAccountId);
          return { ...row, socialAccount: account };
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const post = mockPosts.find((p) => p.id === where.id);
          if (!post) return null;
          const account = mockSocialAccounts.find((a) => a.id === post.socialAccountId);
          return { ...post, socialAccount: account };
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          return mockPosts.find((p) => {
            if (where?.socialAccountId && p.socialAccountId !== where.socialAccountId) return false;
            if (where?.status?.in && !where.status.in.includes(p.status)) return false;
            if (where?.scheduledAt?.gte && p.scheduledAt < where.scheduledAt.gte) return false;
            if (where?.scheduledAt?.lte && p.scheduledAt > where.scheduledAt.lte) return false;
            return true;
          }) ?? null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const post = mockPosts.find((p) => p.id === where.id);
          if (!post) throw new Error('Post not found');
          Object.assign(post, data);
          post.updatedAt = new Date();
          const account = mockSocialAccounts.find((a) => a.id === post.socialAccountId);
          return { ...post, socialAccount: account };
        }),
      },
      autolist: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `autolist-${mockAutolists.length + 1}`,
            companyId: data.companyId ?? 'company-1',
            brandId: data.brandId,
            name: data.name,
            description: data.description ?? null,
            repeatMode: data.repeatMode ?? 'RECYCLE',
            traversalMode: data.traversalMode ?? 'FIFO',
            activeSlots: data.activeSlots,
            status: data.status ?? 'ACTIVE',
            collisionWindowMinutes: data.collisionWindowMinutes ?? 90,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { items: 0 },
          };
          mockAutolists.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const autolist = mockAutolists.find((a) => a.id === where.id);
          if (!autolist) return null;
          const items = mockAutolistItems.filter((i) => i.autolistId === autolist.id);
          const brand = mockBrands.find((b) => b.id === autolist.brandId);
          const accounts = mockSocialAccounts.filter((a) => a.brandId === autolist.brandId);
          return {
            ...autolist,
            items,
            brand: { ...brand, socialAccounts: accounts },
            _count: { items: items.length },
          };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const autolist = mockAutolists.find((a) => a.id === where.id);
          if (!autolist) throw new Error('Autolist not found');
          Object.assign(autolist, data);
          autolist.updatedAt = new Date();
          const items = mockAutolistItems.filter((i) => i.autolistId === autolist.id);
          return { ...autolist, _count: { items: items.length } };
        }),
      },
      autolistItem: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `item-${mockAutolistItems.length + 1}`,
            companyId: data.companyId ?? 'company-1',
            autolistId: data.autolistId,
            content: data.content,
            mediaUrls: data.mediaUrls ?? [],
            platformConfig: data.platformConfig ?? null,
            orderIndex: data.orderIndex ?? 0,
            publishCount: data.publishCount ?? 0,
            lastPublishedAt: null,
            status: data.status ?? 'ACTIVE',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockAutolistItems.push(row);
          return row;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          return mockAutolistItems.find((i) => i.id === where.id && (!where.autolistId || i.autolistId === where.autolistId)) ?? null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const item = mockAutolistItems.find((i) => i.id === where.id);
          if (!item) throw new Error('Item not found');
          if (data.publishCount?.increment) {
            item.publishCount += data.publishCount.increment;
          }
          if (data.lastPublishedAt) item.lastPublishedAt = data.lastPublishedAt;
          if (data.content) item.content = data.content;
          item.updatedAt = new Date();
          return item;
        }),
      },
      marketingJob: {
        create: jest.fn(async ({ data }: any) => {
          const job = {
            id: `job-${mockJobs.length + 1}`,
            companyId: data.companyId ?? 'company-1',
            type: data.type,
            payload: data.payload ?? {},
            scheduledAt: data.scheduledAt,
            status: 'PENDING',
            attempts: 0,
            maxAttempts: 3,
            lastError: null,
            lockedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockJobs.push(job);
          return job;
        }),
      },
    };

    tenancy = new Tenancy();
    queueService = new PostgresJobQueueService(mockPrisma as any, tenancy);

    stubAdapter = new StubSocialNetworkAdapter();
    const metaAdapter = new MetaNetworkAdapter();
    const linkedInAdapter = new LinkedInNetworkAdapter();
    const xAdapter = new XNetworkAdapter();
    const tikTokAdapter = new TikTokNetworkAdapter();
    resolver = new SocialAdapterResolver(metaAdapter, linkedInAdapter, xAdapter, tikTokAdapter, stubAdapter);

    publisherService = new SocialPublisherService(mockPrisma as any, cryptoService, resolver, queueService);
    publisherService.onModuleInit();

    autolistsService = new AutolistsService(mockPrisma as any, queueService);
    autolistsService.onModuleInit();
  });

  describe('Post Scheduling & Queue Integration', () => {
    it('schedules a post, decrypts token in vault, and dispatches publish via queue', async () => {
      const scheduledTime = new Date(Date.now() + 3600 * 1000).toISOString();

      const post = await publisherService.schedulePost({
        brandId: 'brand-1',
        socialAccountId: 'acc-ig',
        content: 'Exciting product launch coming soon! #launch #growth',
        mediaUrls: ['https://cdn.example.com/photo.jpg'],
        platformConfig: { firstComment: '#startup #marketing' },
        scheduledAt: scheduledTime,
      });

      expect(post.id).toBe('post-1');
      expect(post.status).toBe('SCHEDULED');
      expect(post.content).toContain('Exciting product launch');

      // Verifies background queue job was scheduled
      expect(mockJobs).toHaveLength(1);
      expect(mockJobs[0].type).toBe('publish_social_post');
      expect(mockJobs[0].payload.postId).toBe('post-1');

      // Now execute publication
      const result = await publisherService.publishPost(post.id);

      expect(result.published).toBe(true);
      expect(result.externalPostId).toBe('stub_instagram_post_1');
      expect(result.post.status).toBe('PUBLISHED');
      expect(result.post.publishedAt).toBeDefined();

      // Verifies stub adapter recorded call with decrypted token
      expect(stubAdapter.publishedPosts).toHaveLength(1);
      const recorded = stubAdapter.publishedPosts[0]!;
      expect(recorded.platform).toBe('instagram');
      expect(recorded.content).toContain('Exciting product launch');
      expect(recorded.mediaUrls).toEqual(['https://cdn.example.com/photo.jpg']);
    });

    it('handles publication failures and transitions status to FAILED with error message', async () => {
      stubAdapter.setFailNext('linkedin', 'Rate limit exceeded: 429 Too Many Requests');

      const post = await publisherService.schedulePost({
        brandId: 'brand-1',
        socialAccountId: 'acc-li',
        content: 'B2B industry trends report 2026',
        scheduledAt: new Date().toISOString(),
      });

      await expect(publisherService.publishPost(post.id)).rejects.toThrow('Rate limit exceeded');

      const failedPost = await publisherService.getPost(post.id);
      expect(failedPost.status).toBe('FAILED');
      expect(failedPost.failureReason).toContain('Rate limit exceeded');
    });

    it('immediately publishes post via publishNow', async () => {
      const post = await publisherService.schedulePost({
        brandId: 'brand-1',
        socialAccountId: 'acc-x',
        content: 'Breaking news: Q3 product line announced! #breaking',
        scheduledAt: new Date(Date.now() + 86400 * 1000).toISOString(),
      });

      const response = await publisherService.publishNow(post.id);
      expect(response.published).toBe(true);
      expect(response.post.status).toBe('PUBLISHED');
      expect(response.externalPostId).toBe('stub_x_post_1');
    });

    it('syncs metrics from adapter for a published post', async () => {
      const post = await publisherService.schedulePost({
        brandId: 'brand-1',
        socialAccountId: 'acc-tt',
        content: 'Behind the scenes at HQ! #bts #daily',
        scheduledAt: new Date().toISOString(),
      });

      await publisherService.publishPost(post.id);

      const metricsResult = await publisherService.syncMetrics(post.id);
      expect(metricsResult.synced).toBe(true);
      expect(metricsResult.metrics.impressions).toBe(500);
      expect(metricsResult.metrics.likes).toBe(35);
      expect(metricsResult.metrics.comments).toBe(7);
    });
  });

  describe('Multi-Network Adapters Support', () => {
    it('supports Meta, LinkedIn, X, and TikTok platform checks', () => {
      const meta = new MetaNetworkAdapter();
      expect(meta.supports('instagram')).toBe(true);
      expect(meta.supports('facebook')).toBe(true);
      expect(meta.supports('linkedin')).toBe(false);

      const li = new LinkedInNetworkAdapter();
      expect(li.supports('linkedin')).toBe(true);
      expect(li.supports('x')).toBe(false);

      const x = new XNetworkAdapter();
      expect(x.supports('x')).toBe(true);
      expect(x.supports('tiktok')).toBe(false);

      const tt = new TikTokNetworkAdapter();
      expect(tt.supports('tiktok')).toBe(true);
      expect(tt.supports('instagram')).toBe(false);
    });
  });

  describe('Evergreen Autolists & Queue Recycling', () => {
    it('creates an Autolist with active recurring slots and adds content items', async () => {
      const autolist = await autolistsService.createAutolist({
        brandId: 'brand-1',
        name: 'Weekly Growth Tips',
        description: 'Evergreen educational advice for marketers',
        repeatMode: 'RECYCLE',
        traversalMode: 'FIFO',
        activeSlots: [
          { dayOfWeek: 1, time: '10:00', socialAccountIds: ['acc-ig'] }, // Mon 10am
          { dayOfWeek: 3, time: '14:30', socialAccountIds: ['acc-li'] }, // Wed 2:30pm
        ],
        collisionWindowMinutes: 90,
      });

      expect(autolist.id).toBe('autolist-1');
      expect(autolist.repeatMode).toBe('RECYCLE');
      expect(autolist.traversalMode).toBe('FIFO');

      // Add 3 items
      const item1 = await autolistsService.addItem(autolist.id, {
        content: 'Tip 1: Always test your hooks.',
      });
      const item2 = await autolistsService.addItem(autolist.id, {
        content: 'Tip 2: Prioritize video retention.',
      });
      const item3 = await autolistsService.addItem(autolist.id, {
        content: 'Tip 3: Reply to comments in the first hour.',
      });

      expect(item1.id).toBe('item-1');
      expect(item2.id).toBe('item-2');
      expect(item3.id).toBe('item-3');
    });

    it('cycles an Autolist using FIFO traversal and updates item publish count', async () => {
      const autolist = await autolistsService.createAutolist({
        brandId: 'brand-1',
        name: 'FIFO Queue',
        repeatMode: 'RECYCLE',
        traversalMode: 'FIFO',
        activeSlots: [{ dayOfWeek: 2, time: '09:00' }],
      });

      await autolistsService.addItem(autolist.id, { content: 'Post Alpha' });
      await autolistsService.addItem(autolist.id, { content: 'Post Beta' });

      // First cycle should pick item 1 (Post Alpha)
      const cycle1 = await autolistsService.cycleAutolist(autolist.id);
      expect(cycle1.cycled).toBe(true);
      expect(cycle1.autolistItemId).toBe('item-1');

      // Publish the scheduled post to increment publish count
      await publisherService.publishPost(cycle1.scheduledPostId!);
      expect(mockAutolistItems[0].publishCount).toBe(1);

      // Second cycle should pick item 2 (Post Beta) because item 1 publishCount is 1
      const cycle2 = await autolistsService.cycleAutolist(autolist.id);
      expect(cycle2.cycled).toBe(true);
      expect(cycle2.autolistItemId).toBe('item-2');
    });

    it('enforces permutation shuffle: guarantees 100% of items run once before repeating (Story 21)', async () => {
      const autolist = await autolistsService.createAutolist({
        brandId: 'brand-1',
        name: 'Shuffle Queue',
        repeatMode: 'RECYCLE',
        traversalMode: 'SHUFFLE',
        activeSlots: [{ dayOfWeek: 4, time: '11:00' }],
      });

      await autolistsService.addItem(autolist.id, { content: 'Card 1' });
      await autolistsService.addItem(autolist.id, { content: 'Card 2' });
      await autolistsService.addItem(autolist.id, { content: 'Card 3' });

      const chosenItemIds = new Set<string>();

      // Cycle 3 times
      for (let i = 0; i < 3; i++) {
        const cycle = await autolistsService.cycleAutolist(autolist.id);
        expect(cycle.cycled).toBe(true);
        chosenItemIds.add(cycle.autolistItemId!);
        await publisherService.publishPost(cycle.scheduledPostId!);
      }

      // In SHUFFLE mode, every item has min count 0 in the first round,
      // so all 3 distinct items MUST have run before any item can repeat!
      expect(chosenItemIds.size).toBe(3);
      expect(chosenItemIds.has('item-1')).toBe(true);
      expect(chosenItemIds.has('item-2')).toBe(true);
      expect(chosenItemIds.has('item-3')).toBe(true);
    });

    it('enforces 90-minute collision window avoidance', async () => {
      const autolist = await autolistsService.createAutolist({
        brandId: 'brand-1',
        name: 'Collision Protected Autolist',
        activeSlots: [{ dayOfWeek: 1, time: '15:00' }],
        collisionWindowMinutes: 90,
      });

      await autolistsService.addItem(autolist.id, { content: 'Evergreen post' });

      // Create a conflicting post right at 15:00 on Monday
      const slotTime = new Date();
      slotTime.setDate(slotTime.getDate() + ((1 + 7 - slotTime.getDay()) % 7));
      slotTime.setHours(15, 0, 0, 0);

      await publisherService.schedulePost({
        brandId: 'brand-1',
        socialAccountId: 'acc-ig',
        content: 'High priority one-off announcement!',
        scheduledAt: slotTime.toISOString(),
      });

      // Cycle the autolist
      const cycleResult = await autolistsService.cycleAutolist(autolist.id, slotTime);
      expect(cycleResult.cycled).toBe(true);

      // Verify that the autolist post scheduled time was bumped past the 90m buffer
      const scheduledAtDate = new Date(cycleResult.scheduledAt!);
      const differenceMinutes = (scheduledAtDate.getTime() - slotTime.getTime()) / (1000 * 60);

      expect(differenceMinutes).toBeGreaterThanOrEqual(90);
    });
  });
});
