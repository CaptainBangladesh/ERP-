import {
  AUTH_PATHS,
  EMAIL_TEMPLATE_ERROR_CODES,
  LEAD_GUIDANCE_PATHS,
  LEAD_PATHS,
  PLAYBOOK_ERROR_CODES,
  PLAYBOOK_PATHS,
  SCRIPT_PATHS,
  type AuthenticatedSession,
  type CreateLeadRequest,
  type CreatePlaybookRequest,
  type CreateScriptRequest,
  type LeadGuidanceResponse,
  type LeadResponse,
  type PlaybookEnrollmentSummary,
  type PlaybookSummary,
  type ScriptSummary,
  type SignUpRequest,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';
import { createFactories, type Factories } from './harness/factories';

describe('CRM Scripts, Playbooks & Guided Selling', () => {
  let app: TestApp;
  let factories: Factories;

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    session: AuthenticatedSession;
    as: (req: SupertestRequest) => SupertestRequest;
  }

  async function signUp(name: string): Promise<Tenant> {
    const email = `${name.toLowerCase().replace(/\s+/g, '')}_${Math.random().toString(36).slice(2)}@example.com`;
    const res = await app.http
      .post(AUTH_PATHS.signUp)
      .send({ companyName: `${name} Corp`, name: `${name} Owner`, email, password: 'Password123!' } satisfies SignUpRequest)
      .expect(201);
    const session = res.body as AuthenticatedSession;
    return { session, as: (req) => req.set('Authorization', `Bearer ${session.token}`) };
  }

  async function signInColleague(email: string): Promise<Tenant> {
    const res = await app.http.post(AUTH_PATHS.signIn).send({ email, password: 'Password123!' }).expect(200);
    const session = res.body as AuthenticatedSession;
    return { session, as: (req) => req.set('Authorization', `Bearer ${session.token}`) };
  }

  async function createLead(tenant: Tenant, body: CreateLeadRequest): Promise<LeadResponse> {
    const res = await tenant.as(app.http.post(LEAD_PATHS.leads)).send(body).expect(201);
    return res.body as LeadResponse;
  }

  async function createScript(tenant: Tenant, body: CreateScriptRequest): Promise<ScriptSummary> {
    const res = await tenant.as(app.http.post(SCRIPT_PATHS.scripts)).send(body).expect(201);
    return res.body as ScriptSummary;
  }

  beforeAll(async () => {
    app = await createTestApp();
    factories = createFactories(app.prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('creates, lists, updates and deletes scripts, and validates merge-tags with the shared resolver', async () => {
    const owner = await signUp('ScriptsOwner');

    const script = await createScript(owner, {
      title: 'Cold opener',
      body: 'Hi {{lead.name|there}}, this is a quick call about your goals.',
      category: 'opener',
      leadStatus: 'new',
    });
    expect(script.category).toBe('opener');
    expect(script.leadStatus).toBe('new');

    // A blank status means "any status" — stored as null.
    const general = await createScript(owner, {
      title: 'Value recap',
      body: 'Here is what we can do for {{lead.organisationName|your team}}.',
      category: 'general',
      leadStatus: null,
    });
    expect(general.leadStatus).toBeNull();

    const listRes = await owner.as(app.http.get(SCRIPT_PATHS.scripts)).expect(200);
    expect((listRes.body.items as ScriptSummary[])).toHaveLength(2);

    // Unknown tag namespace is refused by the same resolver the email side uses.
    const bad = await owner
      .as(app.http.post(SCRIPT_PATHS.scripts))
      .send({ title: 'Bad', body: 'Hello {{user.foo}}', category: 'opener' })
      .expect(400);
    expect(bad.body.code).toBe(EMAIL_TEMPLATE_ERROR_CODES.invalidTemplateTags);

    const updated = await owner
      .as(app.http.patch(SCRIPT_PATHS.script(script.id)))
      .send({ title: 'Warm opener' })
      .expect(200);
    expect((updated.body as ScriptSummary).title).toBe('Warm opener');

    await owner.as(app.http.delete(SCRIPT_PATHS.script(script.id))).expect(200);
    const afterDelete = await owner.as(app.http.get(SCRIPT_PATHS.scripts)).expect(200);
    expect((afterDelete.body.items as ScriptSummary[])).toHaveLength(1);
  });

  it('gates authoring behind crm:playbooks:write while any rep can read', async () => {
    const owner = await signUp('GateOwner');
    await createScript(owner, { title: 'Opener', body: 'Hi {{lead.name}}', category: 'opener', leadStatus: 'new' });

    await factories.addColleague({
      ownerUserId: owner.session.user.id,
      name: 'Rep Without Manage',
      email: 'rep@gate.test',
      permissions: ['crm:leads:read', 'crm:leads:write'],
    });
    const rep = await signInColleague('rep@gate.test');

    // The rep sees scripts…
    const listRes = await rep.as(app.http.get(SCRIPT_PATHS.scripts)).expect(200);
    expect((listRes.body.items as ScriptSummary[])).toHaveLength(1);

    // …but cannot author them.
    await rep
      .as(app.http.post(SCRIPT_PATHS.scripts))
      .send({ title: 'Nope', body: 'x', category: 'opener' })
      .expect(403);
  });

  it('creates a playbook of ordered steps, numbering them, and refuses a step naming a missing script', async () => {
    const owner = await signUp('PlaybookOwner');
    const opener = await createScript(owner, { title: 'Opener', body: 'Hi {{lead.name}}', category: 'opener', leadStatus: 'new' });

    const created = await owner
      .as(app.http.post(PLAYBOOK_PATHS.playbooks))
      .send({
        name: 'New-lead outreach',
        description: 'How we open a fresh lead',
        steps: [
          { title: 'Call and introduce', instruction: 'Open the relationship', scriptId: opener.id, activityType: 'call' },
          { title: 'Send a recap', instruction: 'Email a summary', activityType: 'email' },
        ],
      } satisfies CreatePlaybookRequest)
      .expect(201);

    const playbook = created.body as PlaybookSummary;
    expect(playbook.steps).toHaveLength(2);
    expect(playbook.steps[0]!.order).toBe(1);
    expect(playbook.steps[1]!.order).toBe(2);
    expect(playbook.steps[0]!.scriptId).toBe(opener.id);

    // A step pointing at a script that does not exist is refused.
    await owner
      .as(app.http.post(PLAYBOOK_PATHS.playbooks))
      .send({
        name: 'Broken',
        steps: [{ title: 'x', instruction: 'y', scriptId: '00000000-0000-0000-0000-000000000000' }],
      })
      .expect(400)
      .expect((res) => expect(res.body.code).toBe(PLAYBOOK_ERROR_CODES.stepScriptNotFound));

    // An empty step list is a validation refusal.
    await owner.as(app.http.post(PLAYBOOK_PATHS.playbooks)).send({ name: 'Empty', steps: [] }).expect(422);
  });

  it('surfaces relevant scripts merged with the lead, keyed to its status', async () => {
    const owner = await signUp('GuidanceOwner');
    const lead = await createLead(owner, { name: 'Acme Prospect', organisationName: 'Acme' } as CreateLeadRequest);

    await createScript(owner, { title: 'New opener', body: 'Hi {{lead.name}}', category: 'opener', leadStatus: 'new' });
    await createScript(owner, { title: 'Any recap', body: 'About {{lead.organisationName}}', category: 'general', leadStatus: null });
    await createScript(owner, { title: 'Contacted follow', body: 'Following up', category: 'discovery', leadStatus: 'contacted' });

    const res = await owner.as(app.http.get(LEAD_GUIDANCE_PATHS.guidance(lead.id))).expect(200);
    const guidance = res.body as LeadGuidanceResponse;

    // A new lead sees the new-keyed script and the any-status script, but not the contacted one.
    const titles = guidance.scripts.map((s) => s.title).sort();
    expect(titles).toEqual(['Any recap', 'New opener']);
    const opener = guidance.scripts.find((s) => s.title === 'New opener')!;
    expect(opener.resolvedBody).toBe('Hi Acme Prospect');

    // Not on a play, so the next-best-action comes from the status.
    expect(guidance.enrollment).toBeNull();
    expect(guidance.nextBestAction.kind).toBe('status-suggestion');
    expect(guidance.nextBestAction.title).toBe('Make first contact');
    expect(guidance.nextBestAction.activityType).toBe('call');
    expect(guidance.nextBestAction.script?.resolvedBody).toBe('Hi Acme Prospect');
  });

  it('enrols a lead on a play, surfaces the current step, and advances the pointer manually to completion', async () => {
    const owner = await signUp('PlayRunner');
    const lead = await createLead(owner, { name: 'Beta Buyer' } as CreateLeadRequest);
    const opener = await createScript(owner, { title: 'Opener', body: 'Hi {{lead.name}}', category: 'opener', leadStatus: 'new' });

    const createdPlaybook = await owner
      .as(app.http.post(PLAYBOOK_PATHS.playbooks))
      .send({
        name: 'Two-step',
        steps: [
          { title: 'Introduce', instruction: 'Say hello', scriptId: opener.id, activityType: 'call' },
          { title: 'Recap', instruction: 'Send a summary', activityType: 'email' },
        ],
      } satisfies CreatePlaybookRequest)
      .expect(201);
    const playbookId = (createdPlaybook.body as PlaybookSummary).id;

    // Enrol.
    const enrolled = await owner
      .as(app.http.post(LEAD_GUIDANCE_PATHS.enroll(lead.id)))
      .send({ playbookId })
      .expect(201);
    const enrollment = enrolled.body as PlaybookEnrollmentSummary;
    expect(enrollment.completedSteps).toBe(0);
    expect(enrollment.totalSteps).toBe(2);
    expect(enrollment.currentStep?.title).toBe('Introduce');

    // Guidance now recommends the current playbook step, with its script merged.
    const g1 = (await owner.as(app.http.get(LEAD_GUIDANCE_PATHS.guidance(lead.id))).expect(200)).body as LeadGuidanceResponse;
    expect(g1.nextBestAction.kind).toBe('playbook-step');
    expect(g1.nextBestAction.title).toContain('Step 1 of 2');
    expect(g1.nextBestAction.script?.resolvedBody).toBe('Hi Beta Buyer');

    // Advance once → step 2.
    const afterOne = (await owner.as(app.http.post(LEAD_GUIDANCE_PATHS.advance(lead.id))).expect(200)).body as PlaybookEnrollmentSummary;
    expect(afterOne.completedSteps).toBe(1);
    expect(afterOne.currentStep?.title).toBe('Recap');
    expect(afterOne.completedAt).toBeNull();

    // Advance again → complete.
    const done = (await owner.as(app.http.post(LEAD_GUIDANCE_PATHS.advance(lead.id))).expect(200)).body as PlaybookEnrollmentSummary;
    expect(done.completedSteps).toBe(2);
    expect(done.currentStep).toBeNull();
    expect(done.completedAt).not.toBeNull();

    // Advancing a completed play is refused.
    await owner
      .as(app.http.post(LEAD_GUIDANCE_PATHS.advance(lead.id)))
      .expect(400)
      .expect((res) => expect(res.body.code).toBe(PLAYBOOK_ERROR_CODES.playbookAlreadyComplete));

    // A finished play falls the recommendation back to the status suggestion.
    const g2 = (await owner.as(app.http.get(LEAD_GUIDANCE_PATHS.guidance(lead.id))).expect(200)).body as LeadGuidanceResponse;
    expect(g2.nextBestAction.kind).toBe('status-suggestion');

    // Unenrol clears it.
    await owner.as(app.http.delete(LEAD_GUIDANCE_PATHS.unenroll(lead.id))).expect(200);
    const g3 = (await owner.as(app.http.get(LEAD_GUIDANCE_PATHS.guidance(lead.id))).expect(200)).body as LeadGuidanceResponse;
    expect(g3.enrollment).toBeNull();
  });

  it('refuses advancing a lead that is on no play, and enrolling on a play that does not exist', async () => {
    const owner = await signUp('EdgeOwner');
    const lead = await createLead(owner, { name: 'Edge Lead' } as CreateLeadRequest);

    await owner
      .as(app.http.post(LEAD_GUIDANCE_PATHS.advance(lead.id)))
      .expect(400)
      .expect((res) => expect(res.body.code).toBe(PLAYBOOK_ERROR_CODES.leadNotEnrolled));

    await owner
      .as(app.http.post(LEAD_GUIDANCE_PATHS.enroll(lead.id)))
      .send({ playbookId: '00000000-0000-0000-0000-000000000000' })
      .expect(404)
      .expect((res) => expect(res.body.code).toBe(PLAYBOOK_ERROR_CODES.playbookNotFound));
  });
});
