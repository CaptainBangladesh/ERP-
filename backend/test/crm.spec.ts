import {
  ACTIVITY_PATHS,
  AUTH_PATHS,
  LEAD_ERROR_CODES,
  LEAD_PATHS,
  LEAD_STATUS_LABEL_ERROR_CODES,
  LEAD_STATUS_LABEL_PATHS,
  PARTY_PATHS,
  WORKFLOW_RULE_PATHS,
  listPath,
  type ActivityListResponse,
  type ActivityResponse,
  type AuthenticatedSession,
  type CreateActivityRequest,
  type CreateLeadRequest,
  type CreatePartyRequest,
  type CreateWorkflowRuleRequest,
  type LeadListResponse,
  type LeadResponse,
  type LeadStatusLabelListResponse,
  type LeadStatusLabelSummary,
  type NotificationListResponse,
  type PartyResponse,
  type QualifyLeadRequest,
  type SignUpRequest,
  type UpdateLeadRequest,
  type WorkflowRuleListResponse,
  type WorkflowRuleResponse,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Leads, over HTTP, against a real database. Nothing is mocked and nothing reaches below the
 * endpoint — `PartyDirectory` is exercised for real, exactly as `ProductCatalogue` is in
 * `inventory.spec.ts`.
 *
 * Two companies are signed up in the isolation block rather than one, because "a lead belongs
 * to a company" is a claim you cannot make with only one company in the database: every query
 * would pass whether or not scoping worked at all.
 */
describe('crm', () => {
  let app: TestApp;

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    session: AuthenticatedSession;
    as: (request: SupertestRequest) => SupertestRequest;
  }

  beforeAll(async () => {
    app = await createTestApp();
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
        companyName: 'Northwind Trading',
        name: 'Ada Okafor',
        email: 'ada@northwind.test',
        password: 'correct-horse-battery',
        ...overrides,
      })
      .expect(201);

    const session = response.body as AuthenticatedSession;
    return { session, as: (request) => request.set('Authorization', `Bearer ${session.token}`) };
  }

  let leadCount = 0;
  async function addLead(
    tenant: Tenant,
    body: Partial<CreateLeadRequest> = {},
  ): Promise<LeadResponse> {
    leadCount++;
    const defaultName = `Lead User ${leadCount}`;
    const response = await tenant
      .as(app.http.post(LEAD_PATHS.leads))
      .send({ name: defaultName, ...body } satisfies CreateLeadRequest)
      .expect(201);

    return response.body as LeadResponse;
  }

  async function change(
    tenant: Tenant,
    id: string,
    body: UpdateLeadRequest,
    status = 200,
  ): Promise<LeadResponse> {
    const response = await tenant
      .as(app.http.patch(LEAD_PATHS.lead(id)))
      .send(body)
      .expect(status);

    return response.body as LeadResponse;
  }

  async function listLeads(tenant: Tenant, query = {}): Promise<LeadListResponse> {
    const response = await tenant
      .as(app.http.get(listPath(LEAD_PATHS.leads, query)))
      .expect(200);

    return response.body as LeadListResponse;
  }

  /** A Party the frontend would have created or found before calling `qualify`. */
  async function addParty(
    tenant: Tenant,
    body: Partial<CreatePartyRequest> = {},
  ): Promise<PartyResponse> {
    const response = await tenant
      .as(app.http.post(PARTY_PATHS.parties))
      .send({ kind: 'organisation', name: 'Kapoor Trading', ...body } satisfies CreatePartyRequest)
      .expect(201);

    return response.body as PartyResponse;
  }

  describe('creating one', () => {
    it('has none until somebody says so', async () => {
      const tenant = await signUp();

      const listed = await listLeads(tenant);
      expect(listed.items).toEqual([]);
      expect(listed.page.total).toBe(0);
    });

    it('records a lead, and lists it in the envelope every list endpoint returns', async () => {
      const tenant = await signUp();
      const created = await addLead(tenant, {
        name: 'Priya Kapoor',
        organisationName: 'Kapoor Trading',
        email: 'priya@kapoor.test',
        phone: '442079460958',
      });

      expect(created).toMatchObject({
        name: 'Priya Kapoor',
        organisationName: 'Kapoor Trading',
        email: 'priya@kapoor.test',
        phone: '442079460958',
        status: 'new',
        partyId: null,
        assignedToUserId: null,
      });

      const listed = await listLeads(tenant, { pageSize: 10 });
      expect(listed.items.map((item) => item.name)).toEqual(['Priya Kapoor']);
      expect(listed.page).toEqual({ number: 1, size: 10, total: 1, pages: 1 });
    });

    it('says what is wrong with the input rather than failing obscurely', async () => {
      const tenant = await signUp();

      const refused = await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: '', source: 'inbound' })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('name');
    });

    it('refuses a source outside the wire vocabulary', async () => {
      const tenant = await signUp();

      const refused = await tenant
        .as(app.http.post(LEAD_PATHS.leads))
        .send({ name: 'Unique Telepathy Lead', source: 'telepathy' })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('source');
    });
  });

  describe('editing one', () => {
    it('changes the ordinary fields, and can move between new and contacted', async () => {
      const tenant = await signUp();
      const created = await addLead(tenant);

      const changed = await change(tenant, created.id, {
        name: 'Priya N. Kapoor',
        status: 'contacted',
      });

      expect(changed.name).toBe('Priya N. Kapoor');
      expect(changed.status).toBe('contacted');
    });

    it('refuses to set qualified or disqualified through the general update', async () => {
      const tenant = await signUp();
      const created = await addLead(tenant);

      const refused = await tenant
        .as(app.http.patch(LEAD_PATHS.lead(created.id)))
        .send({ status: 'qualified' })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('status');
    });

    it('is the same 404 a made-up id gets, for an id nobody in this company has', async () => {
      const tenant = await signUp();

      await tenant
        .as(app.http.patch(LEAD_PATHS.lead('00000000-0000-0000-0000-000000000000')))
        .send({ name: 'Anybody' })
        .expect(404);
    });
  });

  describe('qualifying', () => {
    it('creates a new Party first, then links it — status becomes qualified in one request', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant, { name: 'Priya Kapoor' });
      const party = await addParty(tenant, { name: 'Kapoor Trading' });

      const qualified = await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'create', partyId: party.id } satisfies QualifyLeadRequest)
        .expect(200);

      const body = qualified.body as LeadResponse;
      expect(body.status).toBe('qualified');
      expect(body.partyId).toBe(party.id);
    });

    it('links to an existing Party found beforehand, the same way', async () => {
      const tenant = await signUp();
      const existing = await addParty(tenant, { name: 'Existing Trading Co' });
      const lead = await addLead(tenant, { name: 'Someone at Existing' });

      const qualified = await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'link', partyId: existing.id } satisfies QualifyLeadRequest)
        .expect(200);

      const body = qualified.body as LeadResponse;
      expect(body.status).toBe('qualified');
      expect(body.partyId).toBe(existing.id);
    });

    it('never writes a PartyRole — there is no such write path to call', async () => {
      const tenant = await signUp();
      const party = await addParty(tenant, { name: 'Kapoor Trading' });
      const lead = await addLead(tenant);

      await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'create', partyId: party.id } satisfies QualifyLeadRequest)
        .expect(200);

      // The qualified Party holds no roles: crm's backend has no endpoint that could have
      // given it one, so the only way `prospect` ever lands here is the frontend's own,
      // separate call to Parties' `POST /parties/:id/roles`.
      const detail = await tenant.as(app.http.get(PARTY_PATHS.party(party.id))).expect(200);
      expect((detail.body as PartyResponse).roles).toEqual([]);
    });

    it('refuses a partyId that does not resolve through PartyDirectory', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'link', partyId: '00000000-0000-0000-0000-000000000000' } satisfies QualifyLeadRequest)
        .expect(404);
    });

    it('refuses a partyId belonging to another company', async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

      const acmeParty = await addParty(acme, { name: "Acme's own party" });
      const lead = await addLead(northwind);

      await northwind
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'link', partyId: acmeParty.id } satisfies QualifyLeadRequest)
        .expect(404);
    });

    it('refuses to qualify a lead that already holds a Party', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);
      const first = await addParty(tenant, { name: 'First Party' });
      const second = await addParty(tenant, { name: 'Second Party' });

      await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'create', partyId: first.id } satisfies QualifyLeadRequest)
        .expect(200);

      await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'create', partyId: second.id } satisfies QualifyLeadRequest)
        .expect(409);
    });

    it('refuses to qualify a disqualified lead — reopen it first', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);
      const party = await addParty(tenant);

      await tenant.as(app.http.post(LEAD_PATHS.disqualify(lead.id))).expect(200);

      const refused = await tenant
        .as(app.http.post(LEAD_PATHS.qualify(lead.id)))
        .send({ action: 'create', partyId: party.id } satisfies QualifyLeadRequest)
        .expect(409);

      expect(refused.body.code).toBe(LEAD_ERROR_CODES.leadNotQualifiable);
    });
  });

  describe('disqualifying and reopening', () => {
    it('round-trips through the status held before disqualifying, not a guess', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);
      await change(tenant, lead.id, { status: 'contacted' });

      const disqualified = await tenant
        .as(app.http.post(LEAD_PATHS.disqualify(lead.id)))
        .expect(200);
      expect((disqualified.body as LeadResponse).status).toBe('disqualified');

      const reopened = await tenant.as(app.http.post(LEAD_PATHS.reopen(lead.id))).expect(200);
      // Restored to 'contacted', the status disqualifying interrupted — not reset to 'new'.
      expect((reopened.body as LeadResponse).status).toBe('contacted');
    });

    it('restores new when that is what was held', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      await tenant.as(app.http.post(LEAD_PATHS.disqualify(lead.id))).expect(200);
      const reopened = await tenant.as(app.http.post(LEAD_PATHS.reopen(lead.id))).expect(200);

      expect((reopened.body as LeadResponse).status).toBe('new');
    });

    it('refuses to disqualify one already disqualified', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      await tenant.as(app.http.post(LEAD_PATHS.disqualify(lead.id))).expect(200);

      const refused = await tenant.as(app.http.post(LEAD_PATHS.disqualify(lead.id))).expect(409);
      expect(refused.body.code).toBe(LEAD_ERROR_CODES.leadAlreadyDisqualified);
    });

    it('refuses to reopen one that was never disqualified', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      const refused = await tenant.as(app.http.post(LEAD_PATHS.reopen(lead.id))).expect(409);
      expect(refused.body.code).toBe(LEAD_ERROR_CODES.leadNotDisqualified);
    });
  });

  describe('tenant isolation', () => {
    it('is not a filter any of this code writes, and one company cannot see another', async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

      const theirs = await addLead(northwind, { name: 'Theirs' });
      await addLead(acme, { name: 'Ours' });

      const listed = await listLeads(acme);
      expect(listed.items.map((item) => item.name)).toEqual(['Ours']);

      // By its own identifier, which is the case a list filter would not cover: the id is
      // real, and the answer is the one a made-up id gets.
      await acme.as(app.http.get(LEAD_PATHS.lead(theirs.id))).expect(404);
    });

    it('refuses every lifecycle action on a lead belonging to another company', async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

      const theirs = await addLead(northwind, { name: 'Theirs' });

      await acme.as(app.http.patch(LEAD_PATHS.lead(theirs.id))).send({ name: 'Ours now' }).expect(404);
      await acme.as(app.http.post(LEAD_PATHS.disqualify(theirs.id))).expect(404);
      await acme.as(app.http.post(LEAD_PATHS.reopen(theirs.id))).expect(404);
      await acme
        .as(app.http.post(LEAD_PATHS.qualify(theirs.id)))
        .send({ action: 'link', partyId: theirs.id } satisfies QualifyLeadRequest)
        .expect(404);
    });
  });

  describe('activities', () => {
    it('logs an activity against a lead and reads it back', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      const logged = await tenant
        .as(app.http.post(ACTIVITY_PATHS.activities))
        .send({
          type: 'call',
          notes: 'Discovery call held with Priya.',
          leadId: lead.id,
        } satisfies CreateActivityRequest)
        .expect(201);

      expect((logged.body as ActivityResponse).createdByName).toBe('Ada Okafor');

      const list = await tenant
        .as(app.http.get(ACTIVITY_PATHS.leadActivities(lead.id)))
        .expect(200);

      expect((list.body as ActivityListResponse).items).toHaveLength(1);
    });

    it('enforces the exactly-one-parent rule', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      await tenant
        .as(app.http.post(ACTIVITY_PATHS.activities))
        .send({
          type: 'call',
          notes: 'Invalid activity',
        })
        .expect(422);

      await tenant
        .as(app.http.post(ACTIVITY_PATHS.activities))
        .send({
          type: 'call',
          notes: 'Invalid double parent',
          leadId: lead.id,
          dealId: '00000000-0000-0000-0000-000000000001',
        })
        .expect(422);
    });

    it('completes and reopens a task activity', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      const created = await tenant
        .as(app.http.post(ACTIVITY_PATHS.activities))
        .send({
          type: 'task',
          notes: 'Send quote',
          leadId: lead.id,
        } satisfies CreateActivityRequest)
        .expect(201);

      const actId = (created.body as ActivityResponse).id;

      const completed = await tenant
        .as(app.http.post(ACTIVITY_PATHS.completeTask(actId)))
        .expect(200);

      expect((completed.body as ActivityResponse).completedAt).not.toBeNull();

      const reopened = await tenant
        .as(app.http.post(ACTIVITY_PATHS.reopenTask(actId)))
        .expect(200);

      expect((reopened.body as ActivityResponse).completedAt).toBeNull();
    });
  });

  describe('statuses', () => {
    async function statuses(tenant: Tenant): Promise<LeadStatusLabelSummary[]> {
      const response = await tenant.as(app.http.get(LEAD_STATUS_LABEL_PATHS.labels)).expect(200);
      return (response.body as LeadStatusLabelListResponse).items;
    }

    async function addStatus(
      tenant: Tenant,
      label: string,
      color = '#fdab3d',
      status = 201,
    ): Promise<LeadStatusLabelSummary> {
      const response = await tenant
        .as(app.http.post(LEAD_STATUS_LABEL_PATHS.labels))
        .send({ label, color })
        .expect(status);

      return response.body as LeadStatusLabelSummary;
    }

    it('answers with the four built-in statuses before anything is customised', async () => {
      const tenant = await signUp();

      const items = await statuses(tenant);

      expect(items.map((item) => item.status)).toEqual([
        'new',
        'contacted',
        'qualified',
        'disqualified',
      ]);
      expect(items.every((item) => !item.isCustom)).toBe(true);
      // The lifecycle's two terminal states are not reachable by editing a lead.
      expect(items.filter((item) => item.isSettable).map((item) => item.status)).toEqual([
        'new',
        'contacted',
      ]);
    });

    it('adds a stage of the company\'s own and lets a lead be moved into it', async () => {
      const tenant = await signUp();

      const added = await addStatus(tenant, 'In negotiation');
      expect(added).toMatchObject({
        status: 'in-negotiation',
        label: 'In negotiation',
        isCustom: true,
        isSettable: true,
      });

      const lead = await addLead(tenant);
      const moved = await change(tenant, lead.id, { status: 'in-negotiation' });

      expect(moved.status).toBe('in-negotiation');
      expect((await statuses(tenant)).map((item) => item.status)).toContain('in-negotiation');
    });

    it('refuses a status this company does not have', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      await change(tenant, lead.id, { status: 'in-negotiation' }, 422);
    });

    /**
     * The guarantee the whole design rests on: a lead cannot claim to be qualified without the
     * act that creates the Party behind it, no matter how many stages a company adds.
     */
    it('still refuses to set qualified by editing the lead', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      await change(tenant, lead.id, { status: 'qualified' } as never, 422);
      await change(tenant, lead.id, { status: 'disqualified' } as never, 422);
    });

    it('renames and recolours a built-in status without changing what it is', async () => {
      const tenant = await signUp();

      await tenant
        .as(app.http.patch(LEAD_STATUS_LABEL_PATHS.label('new')))
        .send({ label: 'Fresh', color: '#123456' })
        .expect(200);

      const items = await statuses(tenant);
      const fresh = items.find((item) => item.status === 'new');

      expect(fresh).toMatchObject({ label: 'Fresh', color: '#123456', isCustom: false });
      // Still the shipped lifecycle status underneath — a caption changed, nothing else.
      const lead = await addLead(tenant);
      expect(lead.status).toBe('new');
    });

    it('keeps the four built-ins in lifecycle order after one of them is customised', async () => {
      const tenant = await signUp();

      await tenant
        .as(app.http.patch(LEAD_STATUS_LABEL_PATHS.label('disqualified')))
        .send({ label: 'Dropped' })
        .expect(200);

      expect((await statuses(tenant)).map((item) => item.status)).toEqual([
        'new',
        'contacted',
        'qualified',
        'disqualified',
      ]);
    });

    it('will not remove a built-in status', async () => {
      const tenant = await signUp();

      // Customised first, so the row exists and the refusal is about what it is, not that it
      // is missing.
      await tenant
        .as(app.http.patch(LEAD_STATUS_LABEL_PATHS.label('contacted')))
        .send({ label: 'Reached out' })
        .expect(200);

      const response = await tenant
        .as(app.http.delete(LEAD_STATUS_LABEL_PATHS.label('contacted')))
        .expect(409);

      expect(response.body.code).toBe(LEAD_STATUS_LABEL_ERROR_CODES.leadStatusNotCustom);
    });

    it('will not remove a custom status leads are still in, and says how many', async () => {
      const tenant = await signUp();
      await addStatus(tenant, 'In negotiation');

      const lead = await addLead(tenant);
      await change(tenant, lead.id, { status: 'in-negotiation' });

      const response = await tenant
        .as(app.http.delete(LEAD_STATUS_LABEL_PATHS.label('in-negotiation')))
        .expect(409);

      expect(response.body.code).toBe(LEAD_STATUS_LABEL_ERROR_CODES.leadStatusHasLeads);
      expect(response.body.message).toContain('1 lead is still in "In negotiation"');
    });

    it('removes a custom status once nothing is in it', async () => {
      const tenant = await signUp();
      await addStatus(tenant, 'In negotiation');

      const lead = await addLead(tenant);
      await change(tenant, lead.id, { status: 'in-negotiation' });
      await change(tenant, lead.id, { status: 'contacted' });

      await tenant
        .as(app.http.delete(LEAD_STATUS_LABEL_PATHS.label('in-negotiation')))
        .expect(204);

      expect((await statuses(tenant)).map((item) => item.status)).not.toContain('in-negotiation');
    });

    it('refuses a second status that would land on the same key', async () => {
      const tenant = await signUp();
      await addStatus(tenant, 'In negotiation');

      const response = await tenant
        .as(app.http.post(LEAD_STATUS_LABEL_PATHS.labels))
        .send({ label: 'in NEGOTIATION!', color: '#fdab3d' })
        .expect(409);

      expect(response.body.code).toBe(LEAD_STATUS_LABEL_ERROR_CODES.leadStatusDuplicate);
    });

    it('refuses a custom status that would shadow a built-in one', async () => {
      const tenant = await signUp();

      const response = await tenant
        .as(app.http.post(LEAD_STATUS_LABEL_PATHS.labels))
        .send({ label: 'Contacted', color: '#fdab3d' })
        .expect(409);

      expect(response.body.code).toBe(LEAD_STATUS_LABEL_ERROR_CODES.leadStatusDuplicate);
    });

    it('keeps one company\'s statuses out of another\'s', async () => {
      const northwind = await signUp();
      const other = await signUp({
        companyName: 'Contoso',
        name: 'Bo Chen',
        email: 'bo@contoso.test',
      });

      await addStatus(northwind, 'In negotiation');

      expect((await statuses(other)).map((item) => item.status)).not.toContain('in-negotiation');

      // And it is not settable there either — the check is a read of that company's own rows.
      const lead = await addLead(other);
      await change(other, lead.id, { status: 'in-negotiation' }, 422);
    });
  });

  describe('workflow rules', () => {
    it('creates, lists, updates, and deletes a workflow rule', async () => {
      const tenant = await signUp();

      const created = await tenant
        .as(app.http.post(WORKFLOW_RULE_PATHS.rules))
        .send({
          name: 'Notify on Stage Change',
          triggerType: 'deal.stage_changed',
          triggerConfig: { toStageId: 'stage-123' },
          actionType: 'notify_user',
          actionConfig: { userId: tenant.session.user.id },
          enabled: true,
        } satisfies CreateWorkflowRuleRequest)
        .expect(201);

      const rule = created.body as WorkflowRuleResponse;
      expect(rule.name).toBe('Notify on Stage Change');
      expect(rule.enabled).toBe(true);

      const listed = await tenant
        .as(app.http.get(WORKFLOW_RULE_PATHS.rules))
        .expect(200);

      expect((listed.body as WorkflowRuleListResponse).items).toHaveLength(1);

      const updated = await tenant
        .as(app.http.patch(WORKFLOW_RULE_PATHS.rule(rule.id)))
        .send({ enabled: false })
        .expect(200);

      expect((updated.body as WorkflowRuleResponse).enabled).toBe(false);

      await tenant
        .as(app.http.delete(WORKFLOW_RULE_PATHS.rule(rule.id)))
        .expect(204);
    });

    it('refuses update_field targeting stageId or status', async () => {
      const tenant = await signUp();

      const refused = await tenant
        .as(app.http.post(WORKFLOW_RULE_PATHS.rules))
        .send({
          name: 'Invalid update_field',
          triggerType: 'deal.stage_changed',
          actionType: 'update_field',
          actionConfig: { field: 'stageId', value: 'stage-456' },
        })
        .expect(422);

      expect(refused.body.fields).toHaveProperty('actionConfig');
    });

    it('evaluates matching rules on lead status change and creates a task activity', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      await tenant
        .as(app.http.post(WORKFLOW_RULE_PATHS.rules))
        .send({
          name: 'Task on Contacted',
          triggerType: 'lead.status_changed',
          triggerConfig: { toStatus: 'contacted' },
          actionType: 'create_task',
          actionConfig: { notes: 'Follow up with lead', dueInDays: 3 },
          enabled: true,
        } satisfies CreateWorkflowRuleRequest)
        .expect(201);

      await change(tenant, lead.id, { status: 'contacted' });

      const list = await tenant
        .as(app.http.get(ACTIVITY_PATHS.leadActivities(lead.id)))
        .expect(200);

      // The status change is itself audited onto the Timeline, so the rule's task is asserted
      // for by what it is rather than by being the only thing there.
      const items = (list.body as ActivityListResponse).items;
      const tasks = items.filter((item) => item.type === 'task');
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.notes).toBe('Follow up with lead');
    });

    it('fires multiple matching rules and ignores disabled rules', async () => {
      const tenant = await signUp();
      const lead = await addLead(tenant);

      // Active rule 1: notify_user
      await tenant
        .as(app.http.post(WORKFLOW_RULE_PATHS.rules))
        .send({
          name: 'Rule 1 Notify',
          triggerType: 'lead.status_changed',
          triggerConfig: { toStatus: 'contacted' },
          actionType: 'notify_user',
          actionConfig: { userId: tenant.session.user.id },
          enabled: true,
        })
        .expect(201);

      // Active rule 2: create_task
      await tenant
        .as(app.http.post(WORKFLOW_RULE_PATHS.rules))
        .send({
          name: 'Rule 2 Task',
          triggerType: 'lead.status_changed',
          triggerConfig: { toStatus: 'contacted' },
          actionType: 'create_task',
          actionConfig: { notes: 'Automated task' },
          enabled: true,
        })
        .expect(201);

      // Disabled rule: create_task
      await tenant
        .as(app.http.post(WORKFLOW_RULE_PATHS.rules))
        .send({
          name: 'Rule 3 Disabled',
          triggerType: 'lead.status_changed',
          triggerConfig: { toStatus: 'contacted' },
          actionType: 'create_task',
          actionConfig: { notes: 'Should not create' },
          enabled: false,
        })
        .expect(201);

      await change(tenant, lead.id, { status: 'contacted' });

      const notifications = await tenant
        .as(app.http.get(WORKFLOW_RULE_PATHS.notifications))
        .expect(200);

      expect((notifications.body as NotificationListResponse).items).toHaveLength(1);

      const list = await tenant
        .as(app.http.get(ACTIVITY_PATHS.leadActivities(lead.id)))
        .expect(200);

      const items = (list.body as ActivityListResponse).items;
      const tasks = items.filter((item) => item.type === 'task');
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.notes).toBe('Automated task');
      // The disabled rule stayed disabled: nothing here says what it would have said.
      expect(items.some((item) => item.notes === 'Should not create')).toBe(false);
    });

    it('enforces tenant isolation on workflow rules', async () => {
      const northwind = await signUp();
      const acme = await signUp({ companyName: 'Acme', name: 'Bo Lindqvist', email: 'bo@acme.test' });

      const rule = await northwind
        .as(app.http.post(WORKFLOW_RULE_PATHS.rules))
        .send({
          name: 'Northwind Rule',
          triggerType: 'lead.status_changed',
          actionType: 'notify_user',
          actionConfig: {},
        })
        .expect(201);

      const ruleId = (rule.body as WorkflowRuleResponse).id;

      await acme.as(app.http.get(WORKFLOW_RULE_PATHS.rule(ruleId))).expect(404);

      const acmeRules = await acme.as(app.http.get(WORKFLOW_RULE_PATHS.rules)).expect(200);
      expect((acmeRules.body as WorkflowRuleListResponse).items).toEqual([]);
    });
  });
});
