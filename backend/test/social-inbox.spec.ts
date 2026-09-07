import { DmFlowsService } from '../src/modules/marketing/dm-flows.service';
import { InboxService } from '../src/modules/marketing/inbox.service';
import { CrmBridgeService } from '../src/modules/marketing/crm-bridge.service';
import { SocialInboxWebhooksController } from '../src/modules/marketing/social-inbox-webhooks.controller';
import { Tenancy } from '../src/platform/tenancy';
import { DomainEvents } from '../src/platform/events';

describe('Unified Social Inbox and DM Flows (Ticket 08)', () => {
  let mockBrands: any[];
  let mockSocialAccounts: any[];
  let mockMessages: any[];
  let mockFlows: any[];
  let mockCrmLeads: any[];
  let mockCrmActivities: any[];
  let mockCrmSubmissions: any[];

  let mockPrisma: any;
  let tenancy: Tenancy;
  let domainEvents: DomainEvents;
  let crmBridge: CrmBridgeService;
  let dmFlowsService: DmFlowsService;
  let inboxService: InboxService;
  let webhooksController: SocialInboxWebhooksController;

  const emittedEvents: Array<{ name: string; payload: any }> = [];

  beforeEach(() => {
    mockBrands = [
      {
        id: 'brand-1',
        companyId: 'company-1',
        name: 'Apex Athletics',
        slug: 'apex-athletics',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockSocialAccounts = [
      {
        id: 'account-1',
        companyId: 'company-1',
        brandId: 'brand-1',
        platform: 'instagram',
        accountName: '@apexathletics',
        platformAccountId: 'ig_page_123',
        brand: mockBrands[0],
      },
      {
        id: 'account-2',
        companyId: 'company-1',
        brandId: 'brand-1',
        platform: 'x',
        accountName: '@ApexAthleticsHQ',
        platformAccountId: 'x_page_456',
        brand: mockBrands[0],
      },
    ];
    mockMessages = [];
    mockFlows = [];
    mockCrmLeads = [];
    mockCrmActivities = [];
    mockCrmSubmissions = [];

    emittedEvents.length = 0;

    tenancy = new Tenancy();
    (tenancy as any).currentCompanyId = 'company-1';
    tenancy.withoutCompanyScope = jest.fn(async (_reason, fn) => fn());
    tenancy.runInCompany = jest.fn(async (context: any, fn: any) => {
      const prev = (tenancy as any).currentCompanyId;
      (tenancy as any).currentCompanyId = typeof context === 'string' ? context : context.companyId;
      try {
        return await fn();
      } finally {
        (tenancy as any).currentCompanyId = prev;
      }
    });

    domainEvents = {
      emit: jest.fn((name: string, payload: any) => {
        emittedEvents.push({ name, payload });
      }),
    } as unknown as DomainEvents;

    mockPrisma = {
      marketingBrand: {
        findUnique: jest.fn(async ({ where }) => {
          return mockBrands.find((b) => b.id === where.id) || null;
        }),
        findFirst: jest.fn(async () => mockBrands[0] || null),
      },
      socialAccount: {
        findUnique: jest.fn(async ({ where }) => {
          return mockSocialAccounts.find((a) => a.id === where.id) || null;
        }),
        findFirst: jest.fn(async ({ where }) => {
          if (where.platformAccountId) {
            return mockSocialAccounts.find((a) => a.platformAccountId === where.platformAccountId) || null;
          }
          if (where.platform) {
            return mockSocialAccounts.find((a) => a.platform.toLowerCase() === where.platform.contains.toLowerCase()) || null;
          }
          return mockSocialAccounts[0] || null;
        }),
      },
      socialMessage: {
        create: jest.fn(async ({ data }) => {
          const now = Date.now() + mockMessages.length * 100;
          const created = {
            id: `msg-${mockMessages.length + 1}`,
            createdAt: new Date(now),
            updatedAt: new Date(now),
            ...data,
          };
          mockMessages.push(created);
          return created;
        }),
        findMany: jest.fn(async ({ where, orderBy }) => {
          let res = [...mockMessages];
          if (where?.brandId) {
            res = res.filter((m) => m.brandId === where.brandId);
          }
          if (where?.conversationId) {
            res = res.filter((m) => m.conversationId === where.conversationId);
          }
          if (where?.status) {
            res = res.filter((m) => m.status === where.status);
          }
          if (orderBy?.createdAt === 'desc') {
            res.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          } else if (orderBy?.createdAt === 'asc') {
            res.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          }
          return res;
        }),
        findUnique: jest.fn(async ({ where }) => {
          return mockMessages.find((m) => m.id === where.id) || null;
        }),
        update: jest.fn(async ({ where, data }) => {
          const item = mockMessages.find((m) => m.id === where.id);
          if (!item) return null;
          Object.assign(item, data, { updatedAt: new Date() });
          return item;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          let count = 0;
          for (const m of mockMessages) {
            if (
              (!where.brandId || m.brandId === where.brandId) &&
              (!where.conversationId || m.conversationId === where.conversationId)
            ) {
              Object.assign(m, data, { updatedAt: new Date() });
              count++;
            }
          }
          return { count };
        }),
        count: jest.fn(async () => mockMessages.length),
      },
      dmAutomationFlow: {
        create: jest.fn(async ({ data }) => {
          const created = {
            id: `flow-${mockFlows.length + 1}`,
            triggerCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          mockFlows.push(created);
          return created;
        }),
        findMany: jest.fn(async ({ where }) => {
          let res = [...mockFlows];
          if (where?.brandId) {
            res = res.filter((f) => f.brandId === where.brandId);
          }
          if (where?.isActive !== undefined) {
            res = res.filter((f) => f.isActive === where.isActive);
          }
          return res;
        }),
        findUnique: jest.fn(async ({ where }) => {
          return mockFlows.find((f) => f.id === where.id) || null;
        }),
        update: jest.fn(async ({ where, data }) => {
          const item = mockFlows.find((f) => f.id === where.id);
          if (!item) return null;
          let newTriggerCount = item.triggerCount || 0;
          if (data.triggerCount?.increment) {
            newTriggerCount += data.triggerCount.increment;
          } else if (typeof data.triggerCount === 'number') {
            newTriggerCount = data.triggerCount;
          }
          const { triggerCount, ...rest } = data;
          Object.assign(item, rest, { triggerCount: newTriggerCount, updatedAt: new Date() });
          return item;
        }),
        delete: jest.fn(async ({ where }) => {
          const idx = mockFlows.findIndex((f) => f.id === where.id);
          if (idx >= 0) mockFlows.splice(idx, 1);
          return { id: where.id };
        }),
        count: jest.fn(async () => mockFlows.length),
      },
      lead: {
        findFirst: jest.fn(async ({ where }) => {
          if (where.OR) {
            for (const cond of where.OR) {
              if (cond.email?.equals) {
                const found = mockCrmLeads.find(
                  (l) => l.email?.toLowerCase() === cond.email.equals.toLowerCase(),
                );
                if (found) return found;
              }
              if (cond.phone?.equals) {
                const found = mockCrmLeads.find((l) => l.phone === cond.phone.equals);
                if (found) return found;
              }
            }
          }
          return null;
        }),
        create: jest.fn(async ({ data }) => {
          const created = {
            id: `crm-lead-${mockCrmLeads.length + 1}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          mockCrmLeads.push(created);
          return created;
        }),
        update: jest.fn(async ({ where, data }) => {
          const item = mockCrmLeads.find((l) => l.id === where.id);
          if (!item) return null;
          Object.assign(item, data, { updatedAt: new Date() });
          return item;
        }),
      },
      activity: {
        create: jest.fn(async ({ data }) => {
          const created = {
            id: `act-${mockCrmActivities.length + 1}`,
            createdAt: new Date(),
            ...data,
          };
          mockCrmActivities.push(created);
          return created;
        }),
      },
      leadSubmission: {
        create: jest.fn(async ({ data }) => {
          const created = {
            id: `sub-${mockCrmSubmissions.length + 1}`,
            createdAt: new Date(),
            ...data,
          };
          mockCrmSubmissions.push(created);
          return created;
        }),
      },
      nurtureSequence: {
        findMany: jest.fn(async () => []),
      },
    };

    crmBridge = new CrmBridgeService(mockPrisma, domainEvents, tenancy);
    dmFlowsService = new DmFlowsService(mockPrisma);
    inboxService = new InboxService(mockPrisma, dmFlowsService, crmBridge);
    webhooksController = new SocialInboxWebhooksController(mockPrisma, tenancy, inboxService);
  });

  describe('DmFlowsService (Keyword Automation)', () => {
    it('creates a keyword automation flow and matches messages', async () => {
      const flow = await dmFlowsService.createFlow({
        brandId: 'brand-1',
        name: 'Growth Guide Auto-DM',
        triggerKeyword: 'GUIDE',
        matchType: 'EXACT',
        responseTemplate: 'Thanks for asking! Here is your free guide: {{leadMagnetUrl}}',
        leadMagnetUrl: 'https://apex.com/guide.pdf',
        isActive: true,
      } as any);

      expect(flow.triggerKeyword).toBe('GUIDE');
      expect(flow.matchType).toBe('EXACT');

      // Test matching
      const match = await dmFlowsService.evaluateMessage('brand-1', '  guide  ');
      expect(match).not.toBeNull();
      expect(match!.replyText).toContain('https://apex.com/guide.pdf');
      expect(match!.flow.triggerCount).toBe(1);

      // Non-matching
      const noMatch = await dmFlowsService.evaluateMessage('brand-1', 'Hello there');
      expect(noMatch).toBeNull();
    });

    it('supports CONTAINS match type for keywords embedded in conversational sentences', async () => {
      await dmFlowsService.createFlow({
        brandId: 'brand-1',
        name: 'Pricing Inquiry Flow',
        triggerKeyword: 'pricing',
        matchType: 'CONTAINS',
        responseTemplate: 'Check our pricing here: {{leadMagnetUrl}}',
        leadMagnetUrl: 'https://apex.com/pricing',
        isActive: true,
      } as any);

      const match = await dmFlowsService.evaluateMessage(
        'brand-1',
        'Hey team, can you send me your pricing info please?',
      );
      expect(match).not.toBeNull();
      expect(match!.replyText).toContain('https://apex.com/pricing');
    });
  });

  describe('InboxService & DM Automation', () => {
    it('receives inbound message and auto-replies when keyword triggers match', async () => {
      // Set up flow
      await dmFlowsService.createFlow({
        brandId: 'brand-1',
        name: 'Promo Coupon Flow',
        triggerKeyword: 'DISCOUNT',
        matchType: 'EXACT',
        responseTemplate: 'Here is your 20% discount code: SAVE20! Link: {{leadMagnetUrl}}',
        leadMagnetUrl: 'https://apex.com/shop',
        isActive: true,
      } as any);

      const result = await inboxService.receiveInboundMessage({
        brandId: 'brand-1',
        conversationId: 'ig_conv_999',
        senderId: 'ig_user_101',
        senderName: 'Marcus Vance',
        content: 'discount',
      });

      expect(result.inboundMessage).toBeDefined();
      expect(result.inboundMessage.direction).toBe('inbound');
      expect(result.inboundMessage.status).toBe('unread');

      // Auto-reply should be triggered and stored
      expect(result.autoReplyMessage).not.toBeNull();
      expect(result.autoReplyMessage!.direction).toBe('outbound');
      expect(result.autoReplyMessage!.content).toContain('SAVE20');
      expect(result.autoReplyMessage!.content).toContain('https://apex.com/shop');
      expect(result.autoReplyMessage!.recipientId).toBe('ig_user_101');

      // Both messages exist in mockMessages
      expect(mockMessages.length).toBe(2);
    });

    it('aggregates conversation threads with unread counts and latest messages', async () => {
      // Message 1 in Conv A
      await inboxService.receiveInboundMessage({
        brandId: 'brand-1',
        conversationId: 'thread_1',
        senderId: 'user_1',
        senderName: 'Alice',
        content: 'Hi!',
      });
      // Message 2 in Conv A
      await inboxService.receiveInboundMessage({
        brandId: 'brand-1',
        conversationId: 'thread_1',
        senderId: 'user_1',
        senderName: 'Alice',
        content: 'Are you open today?',
      });
      // Message 1 in Conv B
      await inboxService.receiveInboundMessage({
        brandId: 'brand-1',
        conversationId: 'thread_2',
        senderId: 'user_2',
        senderName: 'Bob',
        content: 'Where is my order?',
      });

      const list = await inboxService.listConversations('brand-1');
      expect(list.items.length).toBe(2);

      const conv1 = list.items.find((c) => c.conversationId === 'thread_1');
      expect(conv1).toBeDefined();
      expect(conv1!.totalMessages).toBe(2);
      expect(conv1!.unreadCount).toBe(2);
      expect(conv1!.latestMessageContent).toBe('Are you open today?');
    });

    it('updates conversation status', async () => {
      await inboxService.receiveInboundMessage({
        brandId: 'brand-1',
        conversationId: 'thread_3',
        senderId: 'user_3',
        content: 'Question',
      });

      const updateRes = await inboxService.updateConversationStatus(
        'brand-1',
        'thread_3',
        'resolved',
      );
      expect(updateRes.success).toBe(true);
      expect(mockMessages[0].status).toBe('resolved');
    });
  });

  describe('Convert to CRM Lead Action', () => {
    it('creates a CRM Lead and attaches full conversation transcript to Activity Timeline', async () => {
      // Ingest conversation with contact info
      await inboxService.receiveInboundMessage({
        brandId: 'brand-1',
        conversationId: 'thread_lead_1',
        senderId: 'ig_sarah',
        senderName: 'Sarah Jenkins',
        content: 'Hello! I would like to inquire about enterprise gym memberships.',
      });

      await inboxService.sendOutboundReply({
        brandId: 'brand-1',
        conversationId: 'thread_lead_1',
        content: 'Hi Sarah! Could you share your email or company name?',
        senderName: 'Apex Rep',
      } as any);

      await inboxService.receiveInboundMessage({
        brandId: 'brand-1',
        conversationId: 'thread_lead_1',
        senderId: 'ig_sarah',
        senderName: 'Sarah Jenkins',
        content: 'Sure, email me at sarah.jenkins@fitcorp.io. We have 50 employees.',
      });

      // Convert to CRM Lead
      const convertRes = await inboxService.convertConversationToLead({
        brandId: 'brand-1',
        conversationId: 'thread_lead_1',
        organisationName: 'FitCorp International',
      } as any);

      expect(convertRes.success).toBe(true);
      expect(convertRes.leadId).toBeDefined();
      expect(convertRes.isNewLead).toBe(true);
      expect(convertRes.leadName).toBe('Sarah Jenkins');
      expect(convertRes.messageCount).toBe(3);

      // Verify CRM Lead record was created
      const crmLead = mockCrmLeads.find((l) => l.id === convertRes.leadId);
      expect(crmLead).toBeDefined();
      expect(crmLead.name).toBe('Sarah Jenkins');
      expect(crmLead.email).toBe('sarah.jenkins@fitcorp.io');
      expect(crmLead.organisationName).toBe('FitCorp International');

      // Verify conversation transcript was logged to CRM Activity Timeline
      const timelineActivity = mockCrmActivities.find(
        (a) => a.leadId === convertRes.leadId && a.notes.includes('Social DM Conversation History'),
      );
      expect(timelineActivity).toBeDefined();
      expect(timelineActivity.type).toBe('note');
      expect(timelineActivity.notes).toContain('Social DM Conversation History');
      expect(timelineActivity.notes).toContain('enterprise gym memberships');
      expect(timelineActivity.notes).toContain('sarah.jenkins@fitcorp.io');

      // Verify domain event emitted
      const leadEvent = emittedEvents.find((e) => e.name === 'marketing.lead.captured');
      expect(leadEvent).toBeDefined();
      expect(leadEvent!.payload.leadId).toBe(convertRes.leadId);

      // Verify all messages in thread are now marked 'resolved'
      const unreadRemaining = mockMessages.filter(
        (m) => m.conversationId === 'thread_lead_1' && m.status !== 'resolved',
      );
      expect(unreadRemaining.length).toBe(0);
    });
  });

  describe('SocialInboxWebhooksController', () => {
    it('verifies Meta challenge handshake via GET request', () => {
      const challenge = webhooksController.verifyWebhook(
        'instagram',
        {
          'hub.mode': 'subscribe',
          'hub.challenge': 'challenge_code_98765',
          'hub.verify_token': 'verify_secret',
        },
      );
      expect(challenge).toBe('challenge_code_98765');
    });

    it('ingests Meta/Instagram Messenger payload and executes automated flow', async () => {
      // Configure automation flow
      await dmFlowsService.createFlow({
        brandId: 'brand-1',
        name: 'VIP Club Welcome',
        triggerKeyword: 'VIP',
        matchType: 'EXACT',
        responseTemplate: 'Welcome to the VIP Club! Access here: {{leadMagnetUrl}}',
        leadMagnetUrl: 'https://apex.com/vip',
        isActive: true,
      } as any);

      // Meta payload format
      const metaPayload = {
        object: 'instagram',
        entry: [
          {
            id: 'ig_page_123',
            time: 1725667200,
            messaging: [
              {
                sender: { id: 'meta_user_444' },
                recipient: { id: 'ig_page_123' },
                timestamp: 1725667200000,
                message: {
                  mid: 'mid.123',
                  text: 'VIP',
                },
              },
            ],
          },
        ],
      };

      const res = await webhooksController.handleSocialInboxWebhook(
        'instagram',
        metaPayload as any,
        { brandId: 'brand-1' },
      );

      expect(res.received).toBe(true);
      expect(res.platform).toBe('instagram');
      expect(res.autoReplied).toBe(true);
      expect(res.flowId).toBeDefined();

      // Check reply message created
      const autoReply = mockMessages.find(
        (m) => m.direction === 'outbound' && (m.metadata as any)?.autoReply === true,
      );
      expect(autoReply).toBeDefined();
      expect(autoReply.content).toContain('Welcome to the VIP Club!');
    });

    it('ingests X (Twitter) Direct Message event format', async () => {
      const xPayload = {
        for_user_id: 'x_page_456',
        direct_message_events: [
          {
            type: 'message_create',
            id: 'dm_event_1',
            created_timestamp: '1725667200000',
            message_create: {
              target: { recipient_id: 'x_page_456' },
              sender_id: 'x_user_555',
              message_data: {
                text: 'Hello from Twitter/X!',
              },
            },
          },
        ],
      };

      const res = await webhooksController.handleSocialInboxWebhook(
        'x',
        xPayload as any,
        { brandId: 'brand-1' },
      );

      expect(res.received).toBe(true);
      expect(res.platform).toBe('x');
      expect(res.messageId).toBeDefined();
      expect(res.autoReplied).toBe(false);

      const msg = mockMessages.find((m) => m.senderId === 'x_user_555');
      expect(msg).toBeDefined();
      expect(msg.content).toBe('Hello from Twitter/X!');
    });
  });
});
