import { CrmBridgeService } from '../src/modules/marketing/crm-bridge.service';
import { FormsService } from '../src/modules/marketing/forms.service';
import { NurtureSequencesService } from '../src/modules/marketing/nurture-sequences.service';
import { AdWebhooksController } from '../src/modules/marketing/ad-webhooks.controller';
import { Tenancy } from '../src/platform/tenancy';
import { DomainEvents } from '../src/platform/events';

describe('Inbound Lead Gen & CRM Handoff (Ticket 07)', () => {
  let mockBrands: any[];
  let mockForms: any[];
  let mockSubmissions: any[];
  let mockSequences: any[];
  let mockCrmLeads: any[];
  let mockCrmSubmissions: any[];
  let mockCrmActivities: any[];
  let mockAdSyncs: any[];

  let mockPrisma: any;
  let tenancy: Tenancy;
  let domainEvents: DomainEvents;
  let crmBridge: CrmBridgeService;
  let formsService: FormsService;
  let nurtureService: NurtureSequencesService;
  let adWebhooksController: AdWebhooksController;

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
    mockForms = [];
    mockSubmissions = [];
    mockSequences = [];
    mockCrmLeads = [];
    mockCrmSubmissions = [];
    mockCrmActivities = [];
    mockAdSyncs = [
      {
        id: 'adsync-1',
        companyId: 'company-1',
        brandId: 'brand-1',
        platform: 'meta',
        adAccountId: 'act_123456',
        brand: mockBrands[0],
      },
    ];

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
      leadCaptureForm: {
        create: jest.fn(async ({ data }) => {
          const item = {
            id: `form-${mockForms.length + 1}`,
            companyId: 'company-1',
            submitCount: 0,
            isActive: true,
            embedCode: null,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockForms.push(item);
          return item;
        }),
        findUnique: jest.fn(async ({ where }) => {
          return mockForms.find((f) => f.id === where.id) || null;
        }),
        findMany: jest.fn(async () => [...mockForms]),
        count: jest.fn(async () => mockForms.length),
        update: jest.fn(async ({ where, data }) => {
          const idx = mockForms.findIndex((f) => f.id === where.id);
          if (idx === -1) return null;
          if (data.submitCount?.increment) {
            mockForms[idx].submitCount = (mockForms[idx].submitCount || 0) + data.submitCount.increment;
            delete data.submitCount;
          }
          mockForms[idx] = { ...mockForms[idx], ...data, updatedAt: new Date() };
          return mockForms[idx];
        }),
        delete: jest.fn(async ({ where }) => {
          const idx = mockForms.findIndex((f) => f.id === where.id);
          if (idx !== -1) mockForms.splice(idx, 1);
          return { id: where.id };
        }),
      },
      leadCaptureSubmission: {
        create: jest.fn(async ({ data }) => {
          const item = {
            id: `sub-${mockSubmissions.length + 1}`,
            companyId: 'company-1',
            ...data,
            submittedAt: new Date(),
          };
          mockSubmissions.push(item);
          return item;
        }),
        findMany: jest.fn(async ({ where }) => {
          return mockSubmissions.filter((s) => !where?.formId || s.formId === where.formId);
        }),
        count: jest.fn(async ({ where }) => {
          return mockSubmissions.filter((s) => !where?.formId || s.formId === where.formId).length;
        }),
      },
      nurtureSequence: {
        create: jest.fn(async ({ data }) => {
          const item = {
            id: `seq-${mockSequences.length + 1}`,
            companyId: 'company-1',
            status: 'ACTIVE',
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockSequences.push(item);
          return item;
        }),
        findUnique: jest.fn(async ({ where }) => {
          return mockSequences.find((s) => s.id === where.id) || null;
        }),
        findMany: jest.fn(async () => [...mockSequences]),
        count: jest.fn(async () => mockSequences.length),
        update: jest.fn(async ({ where, data }) => {
          const idx = mockSequences.findIndex((s) => s.id === where.id);
          if (idx === -1) return null;
          mockSequences[idx] = { ...mockSequences[idx], ...data, updatedAt: new Date() };
          return mockSequences[idx];
        }),
        delete: jest.fn(async ({ where }) => {
          const idx = mockSequences.findIndex((s) => s.id === where.id);
          if (idx !== -1) mockSequences.splice(idx, 1);
          return { id: where.id };
        }),
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
          const item = {
            id: `crm-lead-${mockCrmLeads.length + 1}`,
            companyId: 'company-1',
            email: null,
            phone: null,
            organisationName: null,
            customValues: {},
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockCrmLeads.push(item);
          return item;
        }),
        update: jest.fn(async ({ where, data }) => {
          const idx = mockCrmLeads.findIndex((l) => l.id === where.id);
          if (idx === -1) return null;
          mockCrmLeads[idx] = { ...mockCrmLeads[idx], ...data, updatedAt: new Date() };
          return mockCrmLeads[idx];
        }),
      },
      leadSubmission: {
        create: jest.fn(async ({ data }) => {
          const item = {
            id: `crm-sub-${mockCrmSubmissions.length + 1}`,
            companyId: 'company-1',
            ...data,
            submittedAt: new Date(),
          };
          mockCrmSubmissions.push(item);
          return item;
        }),
      },
      activity: {
        create: jest.fn(async ({ data }) => {
          const item = {
            id: `act-${mockCrmActivities.length + 1}`,
            companyId: 'company-1',
            ...data,
            createdAt: new Date(),
          };
          mockCrmActivities.push(item);
          return item;
        }),
      },
      adAccountSync: {
        findFirst: jest.fn(async () => mockAdSyncs[0]),
      },
    };

    crmBridge = new CrmBridgeService(mockPrisma, domainEvents, tenancy);
    formsService = new FormsService(mockPrisma, tenancy, crmBridge);
    nurtureService = new NurtureSequencesService(mockPrisma);
    adWebhooksController = new AdWebhooksController(mockPrisma, tenancy, crmBridge);
  });

  describe('CRM Bridge Service', () => {
    it('creates a new CRM Lead when contact does not exist and emits domain event', async () => {
      const result = await crmBridge.handoffLead({
        name: 'Sarah Connor',
        email: 'sarah@skynet.com',
        phone: '+1 555-0101',
        organisationName: 'Resistance Corp',
        utm: {
          source: 'linkedin',
          medium: 'cpc',
          campaign: 'cyberdyne-q3',
        },
        sourceName: 'Demo Request Form',
        brandId: 'brand-1',
      });

      expect(result.isNew).toBe(true);
      expect(result.leadId).toBeDefined();
      expect(mockCrmLeads).toHaveLength(1);
      expect(mockCrmLeads[0].name).toBe('Sarah Connor');
      expect(mockCrmLeads[0].email).toBe('sarah@skynet.com');
      expect(mockCrmLeads[0].organisationName).toBe('Resistance Corp');

      // Verifies CRM LeadSubmission was created
      expect(mockCrmSubmissions).toHaveLength(1);
      expect(mockCrmSubmissions[0].leadId).toBe(result.leadId);
      expect(mockCrmSubmissions[0].formName).toBe('Demo Request Form');

      // Verifies CRM Activity timeline entry was logged
      expect(mockCrmActivities).toHaveLength(1);
      expect(mockCrmActivities[0].leadId).toBe(result.leadId);
      expect(mockCrmActivities[0].notes).toContain('source=linkedin');
      expect(mockCrmActivities[0].notes).toContain('campaign=cyberdyne-q3');

      // Verifies domain event was emitted
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]!.name).toBe('marketing.lead.captured');
      expect(emittedEvents[0]!.payload.leadId).toBe(result.leadId);
      expect(emittedEvents[0]!.payload.email).toBe('sarah@skynet.com');
      expect(emittedEvents[0]!.payload.utm.source).toBe('linkedin');
    });

    it('matches existing Lead and applies non-destructive fill without overwriting existing data', async () => {
      // Pre-seed an existing lead with existing name and email, but empty phone and company
      mockCrmLeads.push({
        id: 'existing-1',
        companyId: 'company-1',
        name: 'John Wick',
        email: 'john@continental.hotel',
        phone: null,
        organisationName: null,
        customValues: { vip: true },
      });

      const result = await crmBridge.handoffLead({
        name: 'Different Wick', // Should not overwrite existing John Wick
        email: 'JOHN@continental.hotel', // Case-insensitive match
        phone: '+1 555-8888', // Fills previously empty phone
        organisationName: 'High Table', // Fills previously empty organization
        customFields: { dog: 'Beagle' },
        sourceName: 'Bio Link Form',
        brandId: 'brand-1',
      });

      expect(result.isNew).toBe(false);
      expect(result.leadId).toBe('existing-1');
      expect(mockCrmLeads).toHaveLength(1);
      expect(mockCrmLeads[0].name).toBe('John Wick'); // Preserved
      expect(mockCrmLeads[0].phone).toBe('+1 555-8888'); // Filled
      expect(mockCrmLeads[0].organisationName).toBe('High Table'); // Filled
      expect(mockCrmLeads[0].customValues).toEqual({ dog: 'Beagle', vip: true });

      // Activity timeline entry logged for the repeat touchpoint
      expect(mockCrmActivities).toHaveLength(1);
      expect(mockCrmActivities[0].leadId).toBe('existing-1');
    });
  });

  describe('Lead Capture Forms Service & Public Submission', () => {
    it('creates a lead capture form with generated embed code', async () => {
      const form = await formsService.createForm({
        brandId: 'brand-1',
        name: 'Whitepaper Download',
        description: 'Download 2026 Marketing Benchmarks',
      } as any);

      expect(form.id).toBeDefined();
      expect(form.name).toBe('Whitepaper Download');
      expect(form.submitCount).toBe(0);
      expect(form.embedCode).toContain('/api/marketing/forms/');
      expect(form.schemaFields.length).toBeGreaterThan(0);
    });

    it('submits a public form, increments submit count, and hands off to CRM', async () => {
      const form = await formsService.createForm({
        brandId: 'brand-1',
        name: 'Contact Sales',
      } as any);

      const submission = await formsService.submitPublicForm(form.id, {
        fields: {
          name: 'Ellen Ripley',
          email: 'ripley@weyland.corp',
          phone: '+1 555-4260',
          company: 'Nostromo Logistics',
        },
        utm: {
          source: 'google',
          medium: 'search',
          campaign: 'xenomorph-defense',
        },
      } as any);

      expect(submission.success).toBe(true);
      expect(submission.leadId).toBeDefined();
      expect(submission.submissionId).toBeDefined();
      expect(submission.isNewLead).toBe(true);

      // Verify submitCount incremented
      const updatedForm = await formsService.getForm(form.id);
      expect(updatedForm.submitCount).toBe(1);

      // Verify LeadCaptureSubmission record was stored
      expect(mockSubmissions).toHaveLength(1);
      expect(mockSubmissions[0].formId).toBe(form.id);
      expect(mockSubmissions[0].crmLeadId).toBe(submission.leadId);
      expect(mockSubmissions[0].utmCampaign).toBe('xenomorph-defense');

      // Verify CRM Lead and Activity
      expect(mockCrmLeads).toHaveLength(1);
      expect(mockCrmLeads[0].name).toBe('Ellen Ripley');
      expect(mockCrmActivities[0].notes).toContain('campaign=xenomorph-defense');
    });

    it('rejects public submission if form does not exist or is inactive', async () => {
      await expect(
        formsService.submitPublicForm('non-existent-id', {
          fields: { email: 'test@example.com' },
        } as any),
      ).rejects.toThrow('Form is inactive or does not exist.');

      const form = await formsService.createForm({
        brandId: 'brand-1',
        name: 'Inactive Form',
      } as any);
      await formsService.updateForm(form.id, { isActive: false } as any);

      await expect(
        formsService.submitPublicForm(form.id, {
          fields: { email: 'test@example.com' },
        } as any),
      ).rejects.toThrow('Form is inactive or does not exist.');
    });
  });

  describe('Nurture Sequences Service', () => {
    it('creates, lists, and updates email nurture sequences', async () => {
      const seq = await nurtureService.createSequence({
        brandId: 'brand-1',
        name: 'Inbound Welcome Drip',
        triggerEvent: 'marketing.lead.captured',
        steps: [
          {
            orderIndex: 0,
            delayMinutes: 0,
            emailSubject: 'Welcome to our platform!',
            emailBody: 'Thanks for signing up.',
          },
          {
            orderIndex: 1,
            delayMinutes: 2880, // 48 hours
            emailSubject: 'Schedule your onboarding session',
            emailBody: 'Book a call with our team.',
          },
        ],
      } as any);

      expect(seq.id).toBeDefined();
      expect(seq.name).toBe('Inbound Welcome Drip');
      expect(seq.steps).toHaveLength(2);
      expect(seq.status).toBe('ACTIVE');

      const updated = await nurtureService.updateSequence(seq.id, {
        name: 'Inbound Welcome Drip v2',
        status: 'PAUSED',
      } as any);
      expect(updated.name).toBe('Inbound Welcome Drip v2');
      expect(updated.status).toBe('PAUSED');
    });
  });

  describe('Ad Platform Webhooks Ingestion', () => {
    it('ingests Meta Facebook Lead Ads payload, hands off to CRM, and emits event', async () => {
      const response = await adWebhooksController.handleAdLeadWebhook(
        'facebook',
        {
          field_data: [
            { name: 'full_name', values: ['Thomas Anderson'] },
            { name: 'email', values: ['neo@matrix.io'] },
            { name: 'phone_number', values: ['+1 555-0100'] },
            { name: 'company_name', values: ['Metacortex'] },
          ],
          campaign_name: 'Red Pill Promo Q3',
        },
        { brandId: 'brand-1' },
      );

      expect(response.received).toBe(true);
      expect(response.platform).toBe('facebook');
      expect(response.leadId).toBeDefined();
      expect(response.isNewLead).toBe(true);

      // Verify CRM Lead was created with extracted fields
      expect(mockCrmLeads).toHaveLength(1);
      expect(mockCrmLeads[0].name).toBe('Thomas Anderson');
      expect(mockCrmLeads[0].email).toBe('neo@matrix.io');
      expect(mockCrmLeads[0].organisationName).toBe('Metacortex');

      // Verify domain event emitted
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]!.name).toBe('marketing.lead.captured');
      expect(emittedEvents[0]!.payload.email).toBe('neo@matrix.io');
    });

    it('ingests Google Ads Lead Form payload and links attribution', async () => {
      const response = await adWebhooksController.handleAdLeadWebhook(
        'google',
        {
          user_column_data: [
            { column_id: 'FULL_NAME', string_value: 'Trinity Moss' },
            { column_id: 'EMAIL', string_value: 'trinity@matrix.io' },
            { column_id: 'PHONE_NUMBER', string_value: '+1 555-0200' },
          ],
          campaign_name: 'Zion Cloud Search Ads',
        },
        { brandId: 'brand-1' },
      );

      expect(response.received).toBe(true);
      expect(response.platform).toBe('google');
      expect(mockCrmLeads).toHaveLength(1);
      expect(mockCrmLeads[0].name).toBe('Trinity Moss');
      expect(mockCrmLeads[0].email).toBe('trinity@matrix.io');
      expect(mockCrmActivities[0].notes).toContain('campaign=Zion Cloud Search Ads');
    });
  });
});
