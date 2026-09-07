import {
  AUTH_PATHS,
  MARKETING_PATHS,
  type AuthenticatedSession,
  type BrandSummary,
  type SmartLinkSummary,
} from '@erp/shared';
import { CrmBridgeService } from '../src/modules/marketing/crm-bridge.service';
import { RetentionService, RETENTION_JOB_TYPE } from '../src/modules/marketing/retention.service';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Ticket 12 — the parts of the module you only find out about under load or after a mistake.
 *
 * These run over the real application against a real database, because every one of them is a
 * claim about concurrency, a transaction boundary, or a delete — none of which a mock can
 * honestly answer. The queue's lease and fencing are covered at the unit level in
 * `job-queue.spec.ts`, where the clock can be moved.
 */
describe('Marketing: reliability, the CRM seam, and retention', () => {
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

  let signUps = 0;

  async function signUp(): Promise<Tenant> {
    signUps += 1;
    const response = await app.http
      .post(AUTH_PATHS.signUp)
      .send({
        companyName: `Studio ${signUps}`,
        name: 'Ada Lovelace',
        email: `ada${signUps}@studio.test`,
        password: 'correct-horse-battery',
      })
      .expect(201);

    const session = response.body as AuthenticatedSession;
    return { session, as: (request) => request.set('Authorization', `Bearer ${session.token}`) };
  }

  async function brandFor(tenant: Tenant): Promise<BrandSummary> {
    const response = await tenant.as(app.http.post(MARKETING_PATHS.brands)).send({ name: 'Halcyon' });
    return response.body as BrandSummary;
  }

  // ── 12.3e Clicks are rows ─────────────────────────────────────────────────────────

  describe('bio page clicks', () => {
    it('keeps every one of N concurrent clicks on one link', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      const created = await tenant
        .as(app.http.post(MARKETING_PATHS.smartLinks))
        .send({
          brandId: brand.id,
          slug: 'halcyon',
          title: 'Halcyon',
          buttonLinks: [{ id: 'btn-shop', title: 'Shop', url: 'https://halcyon.test/shop' }],
        })
        .expect(201);

      const link = created.body as SmartLinkSummary;

      // The read-modify-write this replaced lost clicks here, silently: each request read the
      // whole JSON array, pushed one entry and wrote it back, so simultaneous clicks
      // overwrote each other and the number on the dashboard was simply wrong.
      const clicks = 12;
      await Promise.all(
        Array.from({ length: clicks }, () =>
          app.http
            .post(MARKETING_PATHS.publicSmartLinkClick('halcyon'))
            .send({ buttonId: 'btn-shop' }),
        ),
      );

      const rows = await app.prisma.smartLinkClick.count({
        where: { smartLinkId: link.id },
      });
      expect(rows).toBe(clicks);

      const detail = await tenant.as(app.http.get(MARKETING_PATHS.smartLink(link.id))).expect(200);
      expect(detail.body.analytics.clicksByButton['btn-shop']).toBe(clicks);
    });
  });

  // ── 12.2b The transaction crosses the module seam ─────────────────────────────────

  describe('the CRM seam', () => {
    it('leaves no Lead behind when the caller rolls its transaction back', async () => {
      const tenant = await signUp();
      const bridge = app.nest.get(CrmBridgeService);

      const before = await app.prisma.lead.count();

      // Ticket 11 put the submission row, the counter and the lead write in one transaction.
      // Routing the lead write through `CrmLeadIntake` must not quietly split them back apart:
      // a failure after the lead is created would otherwise leave an orphan in the sales
      // pipeline with no submission to explain it.
      await expect(
        app.tenancy.runInCompany(
          { companyId: tenant.session.company.id, grants: 'all' },
          async () =>
            app.scoped.$transaction(async (tx) => {
              await bridge.handoffLead(
                {
                  name: 'Grace Hopper',
                  email: 'grace@navy.test',
                  sourceName: 'Reliability spec',
                },
                { client: tx, deferEmit: true },
              );

              throw new Error('the caller failed after the lead was written');
            }),
        ),
      ).rejects.toThrow('the caller failed after the lead was written');

      expect(await app.prisma.lead.count()).toBe(before);
    });
  });

  // ── 12.3d Retention ───────────────────────────────────────────────────────────────

  describe('analytics retention', () => {
    it('removes page view events past the window and leaves recent ones alone', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const companyId = tenant.session.company.id;

      const site = await app.prisma.trackingSite.create({
        data: {
          companyId,
          brandId: brand.id,
          name: 'Marketing site',
          domain: 'halcyon.test',
          pixelKey: 'pixel-retention-spec',
        },
      });

      const retention = app.nest.get(RetentionService);
      const days = retention.retentionDays();
      const old = new Date(Date.now() - (days + 5) * 24 * 60 * 60 * 1000);

      await app.prisma.pageViewEvent.createMany({
        data: [
          { companyId, trackingSiteId: site.id, visitorId: 'v-old', path: '/', timestamp: old },
          { companyId, trackingSiteId: site.id, visitorId: 'v-old', path: '/a', timestamp: old },
          { companyId, trackingSiteId: site.id, visitorId: 'v-new', path: '/b', timestamp: new Date() },
        ],
      });

      await app.tenancy.runInCompany({ companyId, grants: 'all' }, () => retention.purge());

      const survivors = await app.prisma.pageViewEvent.findMany({
        where: { trackingSiteId: site.id },
        select: { visitorId: true },
      });
      expect(survivors.map((row) => row.visitorId)).toEqual(['v-new']);
    });

    it('schedules its own next run rather than relying on a cron the deploy does not have', async () => {
      const tenant = await signUp();
      await brandFor(tenant);
      const companyId = tenant.session.company.id;

      const retention = app.nest.get(RetentionService);
      await app.tenancy.runInCompany({ companyId, grants: 'all' }, () => retention.purge());

      const queued = await app.prisma.marketingJob.count({
        where: { companyId, type: RETENTION_JOB_TYPE, status: 'PENDING' },
      });
      expect(queued).toBe(1);
    });

    it('does not enqueue a second purge when one is already pending', async () => {
      const tenant = await signUp();
      await brandFor(tenant);
      const companyId = tenant.session.company.id;

      const retention = app.nest.get(RetentionService);
      await retention.ensureScheduled();
      await retention.ensureScheduled();

      const queued = await app.prisma.marketingJob.count({
        where: { companyId, type: RETENTION_JOB_TYPE },
      });
      expect(queued).toBe(1);
    });
  });
});
