import { LiveSocialOAuth } from '../src/modules/marketing/social-oauth';
import { SocialAccountsService } from '../src/modules/marketing/social-accounts.service';
import { SocialPublisherService } from '../src/modules/marketing/social-publisher.service';
import { InboxService } from '../src/modules/marketing/inbox.service';
import { CryptoService } from '../src/modules/marketing/crypto.service';
import { SocialAdapterResolver } from '../src/modules/marketing/adapters/social-adapter.resolver';
import { StubSocialNetworkAdapter } from '../src/modules/marketing/adapters/stub.adapter';
import { DmFlowsService } from '../src/modules/marketing/dm-flows.service';
import { CrmBridgeService } from '../src/modules/marketing/crm-bridge.service';
import { crmIntakeOver } from './harness/crm-intake';
import { quotaLedgerDouble } from './harness/quota-ledger';
import { MARKETING_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../src/http/api-exception';

describe('Social API Rate Limits, Permissions & Messaging Windows (Ticket 10)', () => {
  let mockPosts: any[];
  let mockSocialAccounts: any[];
  let mockMessages: any[];
  let mockBrands: any[];
  let mockPrisma: any;

  let cryptoService: CryptoService;
  let stubOAuth: any;
  let socialAccountsService: SocialAccountsService;
  let publisherService: SocialPublisherService;
  let inboxService: InboxService;

  beforeEach(() => {
    mockPosts = [];
    mockSocialAccounts = [
      {
        id: 'acc-meta-1',
        companyId: 'company-1',
        brandId: 'brand-1',
        platform: 'instagram',
        platformAccountId: 'ig-12345',
        accountName: 'Acme IG',
        encryptedAccessToken: 'dummy',
        encryptedRefreshToken: null,
        tokenExpiresAt: new Date(Date.now() + 86400000),
        healthStatus: 'HEALTHY',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'acc-x-1',
        companyId: 'company-1',
        brandId: 'brand-1',
        platform: 'x',
        platformAccountId: 'x-99999',
        accountName: 'Acme X',
        encryptedAccessToken: 'dummy',
        encryptedRefreshToken: null,
        tokenExpiresAt: new Date(Date.now() + 86400000),
        healthStatus: 'HEALTHY',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockMessages = [];
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

    process.env.ENCRYPTION_SECRET = '01234567890123456789012345678901';
    process.env.META_APP_ID = 'meta-app-123';
    process.env.LINKEDIN_CLIENT_ID = 'linkedin-client-123';
    process.env.X_CLIENT_ID = 'x-client-123';

    cryptoService = new CryptoService();
    mockSocialAccounts[0].encryptedAccessToken = cryptoService.encrypt('mock_meta_token');
    mockSocialAccounts[1].encryptedAccessToken = cryptoService.encrypt('mock_x_token');

    stubOAuth = {
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://example.com/oauth'),
      exchangeCode: jest.fn(),
      refreshToken: jest.fn(),
    };

    mockPrisma = {
      marketingBrand: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(mockBrands.find((b) => b.id === where.id) || null);
        }),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(mockBrands.find((b) => b.id === where.id) || null);
        }),
      },
      socialAccount: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(mockSocialAccounts.find((a) => a.id === where.id) || null);
        }),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(mockSocialAccounts.find((a) => a.id === where.id) || null);
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
        create: jest.fn().mockImplementation(({ data }) => {
          const post = {
            id: `post-${mockPosts.length + 1}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          mockPosts.push(post);
          return Promise.resolve(post);
        }),
        findUnique: jest.fn().mockImplementation(({ where, include }) => {
          const post = mockPosts.find((p) => p.id === where.id);
          if (!post) return Promise.resolve(null);
          if (include?.socialAccount) {
            const acc = mockSocialAccounts.find((a) => a.id === post.socialAccountId);
            return Promise.resolve({ ...post, socialAccount: acc });
          }
          return Promise.resolve(post);
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const post = mockPosts.find((p) => p.id === where.id);
          if (!post) return Promise.resolve(null);
          Object.assign(post, data);
          return Promise.resolve(post);
        }),
      },
      socialMessage: {
        findFirst: jest.fn().mockImplementation(({ where, orderBy, include }) => {
          let list = mockMessages.filter((m) => {
            if (where.brandId && m.brandId !== where.brandId) return false;
            if (where.conversationId && m.conversationId !== where.conversationId) return false;
            if (where.direction && m.direction !== where.direction) return false;
            return true;
          });
          if (orderBy?.createdAt === 'desc') {
            list = list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          }
          const item = list[0] || null;
          if (item && include?.socialAccount) {
            const acc = mockSocialAccounts.find((a) => a.id === item.socialAccountId);
            return Promise.resolve({ ...item, socialAccount: acc });
          }
          return Promise.resolve(item);
        }),
        create: jest.fn().mockImplementation(({ data }) => {
          const msg = {
            id: `msg-${mockMessages.length + 1}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          mockMessages.push(msg);
          return Promise.resolve(msg);
        }),
      },
    };

    socialAccountsService = new SocialAccountsService(mockPrisma, cryptoService, stubOAuth);

    const stubAdapter = new StubSocialNetworkAdapter();
    const resolver = new SocialAdapterResolver(
      null as any,
      null as any,
      null as any,
      null as any,
      stubAdapter,
    );
    const mockQueue: any = {
      registerHandler: jest.fn(),
      enqueue: jest.fn(),
    };

    publisherService = new SocialPublisherService(
      mockPrisma,
      cryptoService,
      resolver,
      mockQueue,
    );

    const mockDmFlows: any = { evaluateMessage: jest.fn().mockResolvedValue(null) };
    const mockCrmBridge: any = { handoffLead: jest.fn().mockResolvedValue({ leadId: 'lead-1', isNew: true }) };
    inboxService = new InboxService(mockPrisma, mockDmFlows, mockCrmBridge, crmIntakeOver(mockPrisma));
  });

  describe('OAuth Permissions and Scopes', () => {
    it('generates Meta OAuth URL containing modern post-Jan 2025 scopes', async () => {
      const liveOAuth = new LiveSocialOAuth();
      const urlString = await liveOAuth.getAuthorizationUrl(
        'instagram',
        'state_token_123',
        'https://app.erp.test/callback',
      );
      const url = new URL(urlString);
      const scopes = url.searchParams.get('scope') || '';

      expect(scopes).toContain('instagram_business_content_publish');
      expect(scopes).toContain('instagram_business_manage_messages');
      expect(scopes).toContain('pages_messaging');
      expect(scopes).toContain('pages_manage_posts');
    });

    it('generates LinkedIn OAuth URL containing organization and member publishing scopes', async () => {
      const liveOAuth = new LiveSocialOAuth();
      const urlString = await liveOAuth.getAuthorizationUrl(
        'linkedin',
        'state_token_123',
        'https://app.erp.test/callback',
      );
      const url = new URL(urlString);
      const scopes = url.searchParams.get('scope') || '';

      expect(scopes).toContain('w_member_social');
      expect(scopes).toContain('w_organization_social');
    });

    it('generates X OAuth URL with PKCE parameters and write permissions', async () => {
      const liveOAuth = new LiveSocialOAuth();
      const urlString = await liveOAuth.getAuthorizationUrl(
        'x',
        'state_token_123',
        'https://app.erp.test/callback',
      );
      const url = new URL(urlString);
      const scopes = url.searchParams.get('scope') || '';

      expect(scopes).toContain('tweet.write');
      expect(scopes).toContain('dm.read');
      expect(scopes).toContain('dm.write');
      expect(url.searchParams.get('code_challenge')).toBeDefined();
    });
  });

  describe('Rate Limit Quota Inspection', () => {
    it('returns Meta 50-posts-per-24h publishing limit and calculates remaining allowance', async () => {
      // Seed 10 existing posts within last 24h
      for (let i = 0; i < 10; i++) {
        mockPosts.push({
          id: `p-${i}`,
          socialAccountId: 'acc-meta-1',
          status: 'PUBLISHED',
          publishedAt: new Date(Date.now() - 3600000),
          createdAt: new Date(Date.now() - 3600000),
        });
      }

      const status = await socialAccountsService.getRateLimitStatus('acc-meta-1');
      expect(status.platform).toBe('instagram');
      expect(status.publishing.limit).toBe(50);
      expect(status.publishing.windowSeconds).toBe(86400);
      expect(status.publishing.used).toBe(10);
      expect(status.publishing.remaining).toBe(40);
      expect(status.messaging.maxInboundWindowHours).toBe(24);
      expect(status.messaging.extendedHumanAgentWindowDays).toBe(7);
    });

    it('returns X 100-posts-per-15min publishing limit', async () => {
      const status = await socialAccountsService.getRateLimitStatus('acc-x-1');
      expect(status.platform).toBe('x');
      expect(status.publishing.limit).toBe(100);
      expect(status.publishing.windowSeconds).toBe(900);
      expect(status.publishing.used).toBe(0);
      expect(status.publishing.remaining).toBe(100);
    });
  });

  describe('Publishing Rate Limit Enforcement', () => {
    it('blocks scheduling when Meta 50-post/24h quota is reached', async () => {
      for (let i = 0; i < 50; i++) {
        mockPosts.push({
          id: `p-${i}`,
          socialAccountId: 'acc-meta-1',
          status: 'PUBLISHED',
          publishedAt: new Date(Date.now() - 1000 * 60 * 60),
          createdAt: new Date(Date.now() - 1000 * 60 * 60),
        });
      }

      await expect(
        publisherService.schedulePost({
          brandId: 'brand-1',
          socialAccountId: 'acc-meta-1',
          content: 'Exceeding quota post',
          scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        }),
      ).rejects.toMatchObject({
        code: MARKETING_ERROR_CODES.rateLimitExceeded,
      });
    });

    it('blocks scheduling when X 100-post/15m quota is reached', async () => {
      for (let i = 0; i < 100; i++) {
        mockPosts.push({
          id: `p-${i}`,
          socialAccountId: 'acc-x-1',
          status: 'PUBLISHED',
          publishedAt: new Date(Date.now() - 1000 * 60 * 5),
          createdAt: new Date(Date.now() - 1000 * 60 * 5),
        });
      }

      await expect(
        publisherService.schedulePost({
          brandId: 'brand-1',
          socialAccountId: 'acc-x-1',
          content: 'Exceeding X quota post',
          scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        }),
      ).rejects.toMatchObject({
        code: MARKETING_ERROR_CODES.rateLimitExceeded,
      });
    });
  });

  describe('Messaging Window & Human Agent Tag Enforcement', () => {
    it('permits outbound reply within the 24-hour Meta window', async () => {
      // Inbound message 2 hours ago
      mockMessages.push({
        id: 'msg-in-1',
        brandId: 'brand-1',
        socialAccountId: 'acc-meta-1',
        conversationId: 'conv-101',
        senderId: 'customer-1',
        direction: 'inbound',
        createdAt: new Date(Date.now() - 2 * 3600 * 1000),
      });

      const reply = await inboxService.sendOutboundReply({
        brandId: 'brand-1',
        socialAccountId: 'acc-meta-1',
        conversationId: 'conv-101',
        content: 'Hello! Happy to assist you.',
      } as any);

      expect(reply).toBeDefined();
      expect(reply.content).toBe('Hello! Happy to assist you.');
    });

    it('rejects outbound reply after 24 hours when humanAgentTag is false or omitted', async () => {
      // Inbound message 26 hours ago
      mockMessages.push({
        id: 'msg-in-2',
        brandId: 'brand-1',
        socialAccountId: 'acc-meta-1',
        conversationId: 'conv-102',
        senderId: 'customer-2',
        direction: 'inbound',
        createdAt: new Date(Date.now() - 26 * 3600 * 1000),
      });

      await expect(
        inboxService.sendOutboundReply({
          brandId: 'brand-1',
          socialAccountId: 'acc-meta-1',
          conversationId: 'conv-102',
          content: 'Late response without tag',
        } as any),
      ).rejects.toMatchObject({
        code: MARKETING_ERROR_CODES.messagingWindowExpired,
      });
    });

    it('permits outbound reply between 24 hours and 7 days when humanAgentTag is true', async () => {
      // Inbound message 3 days ago (72 hours)
      mockMessages.push({
        id: 'msg-in-3',
        brandId: 'brand-1',
        socialAccountId: 'acc-meta-1',
        conversationId: 'conv-103',
        senderId: 'customer-3',
        direction: 'inbound',
        createdAt: new Date(Date.now() - 72 * 3600 * 1000),
      });

      const reply = await inboxService.sendOutboundReply({
        brandId: 'brand-1',
        socialAccountId: 'acc-meta-1',
        conversationId: 'conv-103',
        content: 'Human agent follow-up inquiry',
        humanAgentTag: true,
      } as any);

      expect(reply).toBeDefined();
      expect(reply.metadata?.tag).toBe('HUMAN_AGENT');
      expect(reply.metadata?.humanAgentTag).toBe(true);
    });

    it('rejects outbound reply after 7 days even with humanAgentTag: true', async () => {
      // Inbound message 8 days ago
      mockMessages.push({
        id: 'msg-in-4',
        brandId: 'brand-1',
        socialAccountId: 'acc-meta-1',
        conversationId: 'conv-104',
        senderId: 'customer-4',
        direction: 'inbound',
        createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
      });

      await expect(
        inboxService.sendOutboundReply({
          brandId: 'brand-1',
          socialAccountId: 'acc-meta-1',
          conversationId: 'conv-104',
          content: 'Way too late response',
          humanAgentTag: true,
        } as any),
      ).rejects.toMatchObject({
        code: MARKETING_ERROR_CODES.messagingWindowExpired,
      });
    });
  });
});
