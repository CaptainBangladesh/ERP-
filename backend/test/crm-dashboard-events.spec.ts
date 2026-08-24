import {
  ACTIVITY_PATHS,
  AUTH_PATHS,
  CRM_EVENTS,
  DASHBOARD_PATHS,
  DEAL_PATHS,
  LEAD_PATHS,
  PARTY_PATHS,
  STAGE_PATHS,
  type ActivityCountsResponse,
  type ActivityResponse,
  type AuthenticatedSession,
  type CreateActivityRequest,
  type CreateDealRequest,
  type CreateLeadRequest,
  type CreatePartyRequest,
  type CreateStageRequest,
  type DealResponse,
  type LeadResponse,
  type PartyResponse,
  type PipelineValueResponse,
  type QualifyLeadRequest,
  type SignUpRequest,
  type StageResponse,
  type UpdateDealRequest,
  type WinLossRateResponse,
} from '@erp/shared';
import { DomainEvents, type DomainEvent } from '../src/platform/events';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

describe('crm: pipeline dashboards and domain events', () => {
  let app: TestApp;
  let eventsService: DomainEvents;

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    session: AuthenticatedSession;
    as: (request: SupertestRequest) => SupertestRequest;
  }

  beforeAll(async () => {
    app = await createTestApp();
    eventsService = app.nest.get(DomainEvents);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  async function signUp(overrides: Partial<SignUpRequest> = {}): Promise<Tenant> {
    const response = await app.http
      .post(AUTH_PATHS.signUp)
      .send({
        companyName: 'Acme Corp',
        name: 'John Doe',
        email: 'john@acme.test',
        password: 'correct-horse-battery',
        ...overrides,
      })
      .expect(201);

    const session = response.body as AuthenticatedSession;
    return { session, as: (request) => request.set('Authorization', `Bearer ${session.token}`) };
  }

  async function addLead(tenant: Tenant, body: Partial<CreateLeadRequest> = {}): Promise<LeadResponse> {
    const response = await tenant
      .as(app.http.post(LEAD_PATHS.leads))
      .send({ name: 'Acme Prospect', source: 'inbound', ...body } satisfies CreateLeadRequest)
      .expect(201);
    return response.body as LeadResponse;
  }

  async function addParty(tenant: Tenant, body: Partial<CreatePartyRequest> = {}): Promise<PartyResponse> {
    const response = await tenant
      .as(app.http.post(PARTY_PATHS.parties))
      .send({ kind: 'organisation', name: 'BigCorp', ...body } satisfies CreatePartyRequest)
      .expect(201);
    return response.body as PartyResponse;
  }

  async function addStage(tenant: Tenant, body: Partial<CreateStageRequest> = {}): Promise<StageResponse> {
    const response = await tenant
      .as(app.http.post(STAGE_PATHS.stages))
      .send({ name: 'New Stage', ...body } satisfies CreateStageRequest)
      .expect(201);
    return response.body as StageResponse;
  }

  async function addDeal(tenant: Tenant, body: CreateDealRequest): Promise<DealResponse> {
    const response = await tenant
      .as(app.http.post(DEAL_PATHS.deals))
      .send(body)
      .expect(201);
    return response.body as DealResponse;
  }

  async function addActivity(tenant: Tenant, body: CreateActivityRequest): Promise<ActivityResponse> {
    const response = await tenant
      .as(app.http.post(ACTIVITY_PATHS.activities))
      .send(body)
      .expect(201);
    return response.body as ActivityResponse;
  }

  describe('dashboard endpoints', () => {
    it('returns zeroed state for a company with no deals or activities', async () => {
      const tenant = await signUp();
      await addStage(tenant, { name: 'Discovery' });

      const pvRes = await tenant.as(app.http.get(DASHBOARD_PATHS.pipelineValue)).expect(200);
      const pv = pvRes.body as PipelineValueResponse;
      expect(pv.stages).toHaveLength(1);
      expect(pv.stages[0]?.stageName).toBe('Discovery');
      expect(pv.stages[0]?.dealCount).toBe(0);
      expect(pv.stages[0]?.totalValue.amount).toBe('0.00');
      expect(pv.totalInFlightDeals).toBe(0);
      expect(pv.totalWonDeals).toBe(0);
      expect(pv.totalLostDeals).toBe(0);

      const wlRes = await tenant.as(app.http.get(DASHBOARD_PATHS.winLossRate)).expect(200);
      const wl = wlRes.body as WinLossRateResponse;
      expect(wl).toEqual({ wonCount: 0, lostCount: 0, totalClosed: 0, winRate: 0 });

      const actRes = await tenant.as(app.http.get(DASHBOARD_PATHS.activityCounts)).expect(200);
      const act = actRes.body as ActivityCountsResponse;
      expect(act).toEqual({ byType: [], byUser: [], totalCount: 0 });
    });

    it('calculates pipeline value by stage, win/loss rate, and activity counts correctly', async () => {
      const tenant = await signUp();
      const party = await addParty(tenant);

      const inFlightStage = await addStage(tenant, { name: 'Proposal' });
      const wonStage = await addStage(tenant, { name: 'Closed Won', outcome: 'won' });
      const lostStage = await addStage(tenant, { name: 'Closed Lost', outcome: 'lost' });

      await addDeal(tenant, { name: 'Deal 1', partyId: party.id, stageId: inFlightStage.id, amount: '5000.00' });
      await addDeal(tenant, { name: 'Deal 2', partyId: party.id, stageId: inFlightStage.id, amount: '3000.00' });
      await addDeal(tenant, { name: 'Deal 3', partyId: party.id, stageId: wonStage.id, amount: '10000.00' });
      await addDeal(tenant, { name: 'Deal 4', partyId: party.id, stageId: lostStage.id, amount: '2000.00' });

      await addActivity(tenant, { type: 'call', notes: 'Intro call', partyId: party.id });
      await addActivity(tenant, { type: 'email', notes: 'Followup email', partyId: party.id });

      // 1. Pipeline Value
      const pvRes = await tenant.as(app.http.get(DASHBOARD_PATHS.pipelineValue)).expect(200);
      const pv = pvRes.body as PipelineValueResponse;
      expect(pv.totalInFlightDeals).toBe(2);
      expect(pv.totalInFlightValue.amount).toBe('8000.00');
      expect(pv.totalWonDeals).toBe(1);
      expect(pv.totalWonValue.amount).toBe('10000.00');
      expect(pv.totalLostDeals).toBe(1);
      expect(pv.totalLostValue.amount).toBe('2000.00');

      // 2. Win / Loss Rate
      const wlRes = await tenant.as(app.http.get(DASHBOARD_PATHS.winLossRate)).expect(200);
      const wl = wlRes.body as WinLossRateResponse;
      expect(wl.wonCount).toBe(1);
      expect(wl.lostCount).toBe(1);
      expect(wl.totalClosed).toBe(2);
      expect(wl.winRate).toBe(0.5);

      // 3. Activity Counts
      const actRes = await tenant.as(app.http.get(DASHBOARD_PATHS.activityCounts)).expect(200);
      const act = actRes.body as ActivityCountsResponse;
      expect(act.totalCount).toBe(2);
      expect(act.byType).toEqual(
        expect.arrayContaining([
          { type: 'call', count: 1 },
          { type: 'email', count: 1 },
        ]),
      );
      expect(act.byUser).toHaveLength(1);
      expect(act.byUser[0]?.userName).toBe('John Doe');
      expect(act.byUser[0]?.count).toBe(2);
    });

    it('enforces tenant isolation across dashboard metrics', async () => {
      const tenantA = await signUp({ email: 'a@tenant.test', companyName: 'Company A' });
      const tenantB = await signUp({ email: 'b@tenant.test', companyName: 'Company B' });

      const partyA = await addParty(tenantA);
      const stageA = await addStage(tenantA, { name: 'Stage A' });
      await addDeal(tenantA, { name: 'Deal A', partyId: partyA.id, stageId: stageA.id, amount: '1000.00' });

      const pvResB = await tenantB.as(app.http.get(DASHBOARD_PATHS.pipelineValue)).expect(200);
      const pvB = pvResB.body as PipelineValueResponse;
      expect(pvB.stages).toHaveLength(0);
      expect(pvB.totalInFlightDeals).toBe(0);
    });
  });

  describe('CRM domain events emission', () => {
    it('emits crm.lead.qualified and crm.lead.disqualified on lead lifecycle actions', async () => {
      const tenant = await signUp();
      const party = await addParty(tenant);
      const lead1 = await addLead(tenant, { name: 'Prospect 1' });
      const lead2 = await addLead(tenant, { name: 'Prospect 2' });

      const capturedEvents: DomainEvent[] = [];
      const unsub1 = eventsService.on(CRM_EVENTS.leadQualified, (ev) => {
        capturedEvents.push(ev);
      });
      const unsub2 = eventsService.on(CRM_EVENTS.leadDisqualified, (ev) => {
        capturedEvents.push(ev);
      });

      try {
        await tenant
          .as(app.http.post(LEAD_PATHS.qualify(lead1.id)))
          .send({ action: 'link', partyId: party.id } satisfies QualifyLeadRequest)
          .expect(200);

        await tenant
          .as(app.http.post(LEAD_PATHS.disqualify(lead2.id)))
          .expect(200);

        expect(capturedEvents).toHaveLength(2);

        expect(capturedEvents[0]).toMatchObject({
          name: CRM_EVENTS.leadQualified,
          companyId: tenant.session.company.id,
          payload: {
            leadId: lead1.id,
            partyId: party.id,
          },
        });

        expect(capturedEvents[1]).toMatchObject({
          name: CRM_EVENTS.leadDisqualified,
          companyId: tenant.session.company.id,
          payload: {
            leadId: lead2.id,
          },
        });
      } finally {
        unsub1();
        unsub2();
      }
    });

    it('emits crm.deal.created, crm.deal.stage_changed, crm.deal.won, and crm.deal.lost on deal actions', async () => {
      const tenant = await signUp();
      const party = await addParty(tenant);

      const inFlightStage = await addStage(tenant, { name: 'Discovery' });
      const wonStage = await addStage(tenant, { name: 'Won', outcome: 'won' });
      const lostStage = await addStage(tenant, { name: 'Lost', outcome: 'lost' });

      const capturedEvents: DomainEvent[] = [];
      const unsub1 = eventsService.on(CRM_EVENTS.dealCreated, (ev) => {
        capturedEvents.push(ev);
      });
      const unsub2 = eventsService.on(CRM_EVENTS.dealStageChanged, (ev) => {
        capturedEvents.push(ev);
      });
      const unsub3 = eventsService.on(CRM_EVENTS.dealWon, (ev) => {
        capturedEvents.push(ev);
      });
      const unsub4 = eventsService.on(CRM_EVENTS.dealLost, (ev) => {
        capturedEvents.push(ev);
      });

      try {
        // 1. Create deal in in-flight stage
        const deal = await addDeal(tenant, {
          name: 'Big Sales Deal',
          partyId: party.id,
          stageId: inFlightStage.id,
          amount: '15000.00',
        });

        expect(capturedEvents).toHaveLength(1);
        expect(capturedEvents[0]).toMatchObject({
          name: CRM_EVENTS.dealCreated,
          companyId: tenant.session.company.id,
          payload: {
            dealId: deal.id,
            partyId: party.id,
            stageId: inFlightStage.id,
            name: 'Big Sales Deal',
          },
        });

        // 2. Move deal to Won stage
        await tenant
          .as(app.http.patch(DEAL_PATHS.deal(deal.id)))
          .send({ stageId: wonStage.id } satisfies UpdateDealRequest)
          .expect(200);

        expect(capturedEvents).toHaveLength(3);
        expect(capturedEvents[1]).toMatchObject({
          name: CRM_EVENTS.dealStageChanged,
          payload: {
            dealId: deal.id,
            fromStageId: inFlightStage.id,
            toStageId: wonStage.id,
            outcome: 'won',
          },
        });
        expect(capturedEvents[2]).toMatchObject({
          name: CRM_EVENTS.dealWon,
          payload: {
            dealId: deal.id,
            partyId: party.id,
            stageId: wonStage.id,
          },
        });

        // 3. Move deal to Lost stage
        await tenant
          .as(app.http.patch(DEAL_PATHS.deal(deal.id)))
          .send({ stageId: lostStage.id } satisfies UpdateDealRequest)
          .expect(200);

        expect(capturedEvents).toHaveLength(5);
        expect(capturedEvents[3]).toMatchObject({
          name: CRM_EVENTS.dealStageChanged,
          payload: {
            dealId: deal.id,
            fromStageId: wonStage.id,
            toStageId: lostStage.id,
            outcome: 'lost',
          },
        });
        expect(capturedEvents[4]).toMatchObject({
          name: CRM_EVENTS.dealLost,
          payload: {
            dealId: deal.id,
            partyId: party.id,
            stageId: lostStage.id,
          },
        });
      } finally {
        unsub1();
        unsub2();
        unsub3();
        unsub4();
      }
    });
  });
});
