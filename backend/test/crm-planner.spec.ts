import {
  APPROACH_PLAN_PATHS,
  ACTIVITY_PATHS,
  AUTH_PATHS,
  LEAD_ERROR_CODES,
  LEAD_PATHS,
  PLANNER_NOTE_PATHS,
  TEAM_PLAN_PATHS,
  type ApproachPlanResponse,
  type ActivityFeedResponse,
  type AuthenticatedSession,
  type CreateActivityRequest,
  type CreateLeadRequest,
  type LeadResponse,
  type PlannerNoteResponse,
  type SignUpRequest,
  type TeamPlanResponse,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';
import { createFactories, type Factories } from './harness/factories';

describe('CRM Planner & Notes', () => {
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

  // ─── approach plan ─────────────────────────────────────────────────────────────────

  describe('approach plan (per lead)', () => {
    it('starts empty, upserts a partial plan, patches one field, and clears a field with null', async () => {
      const owner = await signUp('PlanOwner');
      const lead = await createLead(owner, { name: 'Priya Kapoor' });

      // No plan yet — an all-null empty plan, never an empty body.
      const initial = await owner.as(app.http.get(APPROACH_PLAN_PATHS.byLead(lead.id))).expect(200);
      const initialPlan = initial.body as ApproachPlanResponse;
      expect(initialPlan.angle).toBeNull();
      expect(initialPlan.updatedAt).toBeNull();

      // First save creates the row; absent fields stay null.
      const created = await owner
        .as(app.http.put(APPROACH_PLAN_PATHS.byLead(lead.id)))
        .send({ angle: 'Lead with the migration pain', decisionMakers: 'Priya (CFO), plus IT sign-off' })
        .expect(200);
      const plan = created.body as ApproachPlanResponse;
      expect(plan.angle).toBe('Lead with the migration pain');
      expect(plan.decisionMakers).toContain('Priya (CFO)');
      expect(plan.objections).toBeNull();
      expect(plan.nextSteps).toBeNull();
      expect(plan.updatedByUserId).toBe(owner.session.user.id);

      // A partial patch leaves untouched fields alone.
      const patched = await owner
        .as(app.http.put(APPROACH_PLAN_PATHS.byLead(lead.id)))
        .send({ objections: 'Price vs incumbent' })
        .expect(200);
      const patchedPlan = patched.body as ApproachPlanResponse;
      expect(patchedPlan.objections).toBe('Price vs incumbent');
      expect(patchedPlan.angle).toBe('Lead with the migration pain');

      // A field sent null is cleared.
      const cleared = await owner
        .as(app.http.put(APPROACH_PLAN_PATHS.byLead(lead.id)))
        .send({ angle: null })
        .expect(200);
      expect((cleared.body as ApproachPlanResponse).angle).toBeNull();
      expect((cleared.body as ApproachPlanResponse).objections).toBe('Price vs incumbent');

      // Reads back the same single row.
      const read = await owner.as(app.http.get(APPROACH_PLAN_PATHS.byLead(lead.id))).expect(200);
      expect((read.body as ApproachPlanResponse).objections).toBe('Price vs incumbent');
    });

    it('deletes a plan and refuses a plan on a lead that does not exist', async () => {
      const owner = await signUp('PlanDelete');
      const lead = await createLead(owner, { name: 'Marcus Bell' });

      await owner.as(app.http.put(APPROACH_PLAN_PATHS.byLead(lead.id))).send({ notes: 'Warm intro via Sam' }).expect(200);
      await owner.as(app.http.delete(APPROACH_PLAN_PATHS.byLead(lead.id))).expect(200);
      const afterDelete = await owner.as(app.http.get(APPROACH_PLAN_PATHS.byLead(lead.id))).expect(200);
      expect((afterDelete.body as ApproachPlanResponse).notes).toBeNull();
      expect((afterDelete.body as ApproachPlanResponse).updatedAt).toBeNull();

      // A plan hung off a lead this company can't see is a 404 on the lead.
      await owner
        .as(app.http.get(APPROACH_PLAN_PATHS.byLead('00000000-0000-0000-0000-000000000000')))
        .expect(404)
        .expect((res) => expect(res.body.code).toBe(LEAD_ERROR_CODES.leadNotFound));
    });

    it('refuses an over-long field with a 422', async () => {
      const owner = await signUp('PlanValidate');
      const lead = await createLead(owner, { name: 'Long Winded' });
      await owner
        .as(app.http.put(APPROACH_PLAN_PATHS.byLead(lead.id)))
        .send({ angle: 'x'.repeat(5001) })
        .expect(422);
    });

    it('does not leak one company’s plan to another', async () => {
      const a = await signUp('PlanTenantA');
      const b = await signUp('PlanTenantB');
      const leadA = await createLead(a, { name: 'A Lead' });
      await a.as(app.http.put(APPROACH_PLAN_PATHS.byLead(leadA.id))).send({ angle: 'secret angle' }).expect(200);

      // Tenant B cannot even see the lead, let alone its plan.
      await b.as(app.http.get(APPROACH_PLAN_PATHS.byLead(leadA.id))).expect(404);
    });
  });

  // ─── personal planner notes ─────────────────────────────────────────────────────────

  describe('personal planner notes (per rep)', () => {
    it('starts empty, saves, and is private to each rep', async () => {
      const owner = await signUp('NotesOwner');
      await factories.addColleague({
        ownerUserId: owner.session.user.id,
        name: 'Second Rep',
        email: 'rep2@notes.test',
        permissions: ['crm:activities:read'],
      });
      const rep = await signInColleague('rep2@notes.test');

      const empty = await owner.as(app.http.get(PLANNER_NOTE_PATHS.myNotes)).expect(200);
      expect(empty.body as PlannerNoteResponse).toEqual({ body: '', updatedAt: null });

      const saved = await owner
        .as(app.http.put(PLANNER_NOTE_PATHS.myNotes))
        .send({ body: 'Mon: call the Kapoor account\nTue: pipeline review' })
        .expect(200);
      expect((saved.body as PlannerNoteResponse).body).toContain('Kapoor');
      expect((saved.body as PlannerNoteResponse).updatedAt).not.toBeNull();

      // The colleague's planner is their own — the owner's note is not visible.
      const repNotes = await rep.as(app.http.get(PLANNER_NOTE_PATHS.myNotes)).expect(200);
      expect((repNotes.body as PlannerNoteResponse).body).toBe('');

      // Re-saving updates the same row rather than stacking a second.
      const updated = await owner.as(app.http.put(PLANNER_NOTE_PATHS.myNotes)).send({ body: 'rewritten' }).expect(200);
      expect((updated.body as PlannerNoteResponse).body).toBe('rewritten');
      const rows = await app.prisma.plannerNote.count({ where: { userId: owner.session.user.id } });
      expect(rows).toBe(1);
    });

    it('surfaces "my tasks" through the existing activities filter, no new endpoint', async () => {
      const owner = await signUp('TasksOwner');
      const lead = await createLead(owner, { name: 'Task Lead' });

      // A task activity defaults its assignee to its creator (ticket 01).
      await owner
        .as(app.http.post(ACTIVITY_PATHS.activities))
        .send({ type: 'task', notes: 'Follow up on quote', leadId: lead.id } satisfies CreateActivityRequest)
        .expect(201);
      // A non-task activity should not show up in the planner's task view.
      await owner
        .as(app.http.post(ACTIVITY_PATHS.activities))
        .send({ type: 'call', notes: 'Discovery', leadId: lead.id } satisfies CreateActivityRequest)
        .expect(201);

      const mine = await owner
        .as(
          app.http.get(
            `${ACTIVITY_PATHS.activities}?filter.assignedToUserId=${owner.session.user.id}&filter.type=task`,
          ),
        )
        .expect(200);
      const items = (mine.body as ActivityFeedResponse).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.type).toBe('task');
    });
  });

  // ─── shared team plan ───────────────────────────────────────────────────────────────

  describe('shared team plan (per company)', () => {
    it('starts empty, a manager writes it, and the whole team reads the same one', async () => {
      const owner = await signUp('TeamPlanOwner');
      await factories.addColleague({
        ownerUserId: owner.session.user.id,
        name: 'Reading Rep',
        email: 'reader@team.test',
        permissions: ['crm:team:read'],
      });
      const reader = await signInColleague('reader@team.test');

      const empty = await owner.as(app.http.get(TEAM_PLAN_PATHS.teamPlan)).expect(200);
      expect(empty.body as TeamPlanResponse).toEqual({ body: '', updatedByUserId: null, updatedAt: null });

      const saved = await owner
        .as(app.http.put(TEAM_PLAN_PATHS.teamPlan))
        .send({ body: 'Q3 target: 40 new logos. Focus: mid-market fintech.' })
        .expect(200);
      expect((saved.body as TeamPlanResponse).updatedByUserId).toBe(owner.session.user.id);

      // Everyone on the team reads the same shared plan.
      const asRead = await reader.as(app.http.get(TEAM_PLAN_PATHS.teamPlan)).expect(200);
      expect((asRead.body as TeamPlanResponse).body).toContain('40 new logos');

      // Only one row per company — a re-save edits it in place.
      await owner.as(app.http.put(TEAM_PLAN_PATHS.teamPlan)).send({ body: 'revised' }).expect(200);
      const count = await app.prisma.teamPlan.count();
      expect(count).toBe(1);
    });

    it('lets a team-reader read but not write, and hides it from a rep without the team gate', async () => {
      const owner = await signUp('TeamPlanGate');
      await factories.addColleague({
        ownerUserId: owner.session.user.id,
        name: 'Read Only',
        email: 'ro@team.test',
        permissions: ['crm:team:read'],
      });
      await factories.addColleague({
        ownerUserId: owner.session.user.id,
        name: 'No Team',
        email: 'noteam@team.test',
        permissions: ['crm:leads:read'],
      });
      const reader = await signInColleague('ro@team.test');
      const outsider = await signInColleague('noteam@team.test');

      // A reader can see the plan…
      await reader.as(app.http.get(TEAM_PLAN_PATHS.teamPlan)).expect(200);
      // …but cannot write it — that needs crm:team:manage.
      await reader.as(app.http.put(TEAM_PLAN_PATHS.teamPlan)).send({ body: 'nope' }).expect(403);

      // A rep without the team gate can't even read it.
      await outsider.as(app.http.get(TEAM_PLAN_PATHS.teamPlan)).expect(403);
    });
  });
});
