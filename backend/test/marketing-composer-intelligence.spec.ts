import {
  AUTH_PATHS,
  MARKETING_PATHS,
  NETWORK_LIMITS,
  validateForNetwork,
  type AuthenticatedSession,
  type BestTimeResponse,
  type BrandSummary,
  type ScheduledPostSummary,
  type SocialAccountSummary,
} from '@erp/shared';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Ticket 14 phase 1 — the composer's model-free intelligence.
 *
 * The three cases the ticket names: a post over the limit for one selected network but not
 * another, a brand with no history falling back and saying so, and (in
 * `application/src/modules/marketing/composer-intelligence.test.ts`) a template applied to a
 * draft that already has text.
 *
 * These run over the real router against a real database, because the claim being made is
 * that the *server* refuses — a client-side validator would pass this suite while leaving the
 * limit unenforced, which is the failure 14m exists to prevent.
 */
describe('Marketing: composer intelligence (phase 1)', () => {
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
        companyName: `Composer ${signUps}`,
        name: 'Ada Lovelace',
        email: `ada.composer${signUps}@studio.test`,
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

  async function accountFor(
    tenant: Tenant,
    brand: BrandSummary,
    platform: string,
  ): Promise<SocialAccountSummary> {
    const response = await tenant
      .as(app.http.post(MARKETING_PATHS.connectAccount(brand.id)))
      .send({
        platform,
        accountName: `@halcyon_${platform}`,
        platformAccountId: `${platform}_1`,
        accessToken: 'super_secret_access_token_abcd',
      })
      .expect(201);
    return response.body as SocialAccountSummary;
  }

  async function postFor(
    tenant: Tenant,
    brand: BrandSummary,
    account: SocialAccountSummary,
    content: string,
  ): Promise<ScheduledPostSummary> {
    const response = await tenant
      .as(app.http.post(MARKETING_PATHS.posts))
      .send({
        brandId: brand.id,
        socialAccountId: account.id,
        content,
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(201);
    return response.body as ScheduledPostSummary;
  }

  // ── 14.1 / 14m Per-network limits, enforced on the server ─────────────────────────

  describe('per-network limits', () => {
    /**
     * The case the ticket names: one draft, two selected networks, over the limit on exactly
     * one of them. The interesting half is the second assertion — a validator that refused
     * everything long would also pass the first.
     */
    it('refuses the post on X and publishes the same text to Facebook', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      const overX = 'a'.repeat(NETWORK_LIMITS.x.characterLimit + 40);
      expect(overX.length).toBeLessThan(NETWORK_LIMITS.facebook.characterLimit);

      const x = await accountFor(tenant, brand, 'x');
      const facebook = await accountFor(tenant, brand, 'facebook');

      const onX = await postFor(tenant, brand, x, overX);
      const refusal = await tenant
        .as(app.http.post(MARKETING_PATHS.publishPostNow(onX.id)))
        .expect(400);

      expect(String(refusal.body.error?.message ?? refusal.body.message)).toContain('X allows 280');

      const onFacebook = await postFor(tenant, brand, facebook, overX);
      await tenant.as(app.http.post(MARKETING_PATHS.publishPostNow(onFacebook.id))).expect(201);

      const published = await app.prisma.scheduledPost.findUnique({ where: { id: onFacebook.id } });
      expect(published?.status).toBe('PUBLISHED');
    });

    /** The table and the validator are one thing, and both workspaces read this one copy. */
    it('reads its limits from the shared table rather than a second copy', () => {
      const overThreads = validateForNetwork('threads', {
        content: '#one #two #three',
        mediaCount: 0,
      });
      expect(overThreads.map((violation) => violation.code)).toContain('hashtag_limit');

      const onFacebook = validateForNetwork('facebook', {
        content: '#one #two #three',
        mediaCount: 0,
      });
      expect(onFacebook).toEqual([]);
    });
  });

  // ── 14.2 / 14i-14l Best times, and saying whose data they are ─────────────────────

  describe('best time to post', () => {
    /**
     * A brand with no posting history must not be handed a global median dressed up as its
     * own audience. `source` and `sampleSize` are what make that impossible to get wrong.
     */
    it('falls back to the global figure and labels it', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      const response = await tenant
        .as(
          app.http.get(
            `${MARKETING_PATHS.bestTimes}?brandId=${brand.id}&platform=instagram`,
          ),
        )
        .expect(200);

      const best = response.body as BestTimeResponse;
      expect(best.source).toBe('global');
      expect(best.sampleSize).toBe(0);
      expect(best.timezone).toBe('UTC');
      expect(best.recommendations.length).toBeGreaterThan(0);
    });

    /** The recompute is queued, never run while the composer waits. */
    it('queues the recompute rather than computing it in the handler', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      await tenant
        .as(app.http.get(`${MARKETING_PATHS.bestTimes}?brandId=${brand.id}&platform=instagram`))
        .expect(200);

      const jobs = await app.prisma.marketingJob.findMany({
        where: { type: 'marketing.insights.best_times' },
      });
      expect(jobs).toHaveLength(1);

      // Asked twice, queued once — the retention service's de-duplication, same shape.
      await tenant
        .as(app.http.get(`${MARKETING_PATHS.bestTimes}?brandId=${brand.id}&platform=instagram`))
        .expect(200);

      const again = await app.prisma.marketingJob.findMany({
        where: { type: 'marketing.insights.best_times' },
      });
      expect(again).toHaveLength(1);
    });

    /** A brand id is a uuid somebody keeps. Membership is checked, and absence answers 404. */
    it('answers 404 for a brand in another company', async () => {
      const mine = await signUp();
      const theirs = await signUp();
      const brand = await brandFor(theirs);

      await mine
        .as(app.http.get(`${MARKETING_PATHS.bestTimes}?brandId=${brand.id}&platform=instagram`))
        .expect(404);
    });
  });

  // ── 14.4 / 14o The snippet library ────────────────────────────────────────────────

  describe('snippet library', () => {
    it('starts a new brand with the public starter set, scoped to that brand', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      const response = await tenant
        .as(app.http.get(`${MARKETING_PATHS.snippets}?filter.brandId=${brand.id}`))
        .expect(200);

      const items = response.body.items as Array<{ brandId: string; body: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.brandId === brand.id)).toBe(true);
      // Bodies are text. Nothing here is markup, and nothing renders them as markup.
      expect(items.every((item) => !item.body.includes('<'))).toBe(true);
    });
  });
});
