import {
  AUTH_PATHS,
  MARKETING_PATHS,
  type AuthenticatedSession,
  type BrandSummary,
  type CompetitorListResponse,
  type CompetitorSummary,
  type ContentFeedEntryListResponse,
  type ContentFeedListResponse,
  type ContentFeedSummary,
  type SocialAccountSummary,
  type SocialRateLimitStatus,
} from '@erp/shared';
import { StubSocialNetworkAdapter } from '../src/modules/marketing/adapters/stub.adapter';
import { publishingWindowFor, quotaSpentInWindow } from '../src/modules/marketing/publishing-quota';
import { SocialAdapterResolver } from '../src/modules/marketing/adapters/social-adapter.resolver';
import {
  COMPETITOR_SNAPSHOT_JOB_TYPE,
  CompetitorsService,
} from '../src/modules/marketing/competitors.service';
import {
  ContentFeedsService,
  FEED_POLL_JOB_TYPE,
} from '../src/modules/marketing/content-feeds.service';
import { JobQueueWorkerService } from '../src/modules/marketing/job-queue-worker.service';
import { StubOutboundFetchService } from '../src/modules/marketing/outbound-fetch.service';
import { runInWorker } from '../src/modules/marketing/worker-context';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

/**
 * Ticket 15 — external content sources, over the real application and a real database.
 *
 * Every claim here is about a boundary: what the module will connect to, what it stores from a
 * stranger's document, and whose quota a benchmark read spends. None of those can be answered
 * honestly by a mock, so the only double in play is the fetch guard's own test stub — which
 * runs the *same* address check the live guard does and then serves canned bytes.
 */
describe('Marketing: RSS ingest and competitor benchmarking', () => {
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

  let signUps = 0;

  beforeEach(async () => {
    await resetDatabase(app);
    outbound().reset();
    stubAdapter().reset();
  });

  function outbound(): StubOutboundFetchService {
    return app.nest.get(StubOutboundFetchService);
  }

  function stubAdapter(): StubSocialNetworkAdapter {
    return app.nest.get(SocialAdapterResolver).getStub();
  }

  async function signUp(): Promise<Tenant> {
    signUps += 1;
    const response = await app.http
      .post(AUTH_PATHS.signUp)
      .send({
        companyName: `Studio ${signUps}`,
        name: 'Ada Lovelace',
        email: `ada${signUps}@sources.test`,
        password: 'correct-horse-battery',
      })
      .expect(201);

    const session = response.body as AuthenticatedSession;
    return { session, as: (request) => request.set('Authorization', `Bearer ${session.token}`) };
  }

  async function brandFor(tenant: Tenant): Promise<BrandSummary> {
    const response = await tenant
      .as(app.http.post(MARKETING_PATHS.brands))
      .send({ name: 'Halcyon' })
      .expect(201);
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

  async function feedFor(
    tenant: Tenant,
    brand: BrandSummary,
    url: string,
  ): Promise<ContentFeedSummary> {
    const response = await tenant
      .as(app.http.post(MARKETING_PATHS.contentFeeds))
      .send({ brandId: brand.id, name: 'Industry news', url })
      .expect(201);
    return response.body as ContentFeedSummary;
  }

  async function readFeed(tenant: Tenant, id: string): Promise<ContentFeedSummary> {
    const response = await tenant.as(app.http.get(MARKETING_PATHS.contentFeeds)).expect(200);
    const feeds = (response.body as ContentFeedListResponse).items;
    const feed = feeds.find((row) => row.id === id);
    if (!feed) throw new Error(`Feed ${id} is not in the list`);
    return feed;
  }

  async function entriesFor(tenant: Tenant): Promise<ContentFeedEntryListResponse['items']> {
    const response = await tenant
      .as(app.http.get(MARKETING_PATHS.contentFeedEntries))
      .expect(200);
    return (response.body as ContentFeedEntryListResponse).items;
  }

  /** Drains the queue the way the deployed worker does — tenant frame, worker mark and all. */
  async function drainQueue(): Promise<void> {
    const worker = app.nest.get(JobQueueWorkerService);
    for (let pass = 0; pass < 5; pass += 1) {
      const processed = await worker.processNextBatch(20);
      if (processed === 0) return;
    }
  }

  function rss(items: Array<{ title: string; link: string; guid?: string }>): string {
    const entries = items
      .map(
        (item) =>
          `<item><title>${item.title}</title><link>${item.link}</link>` +
          `${item.guid ? `<guid>${item.guid}</guid>` : ''}` +
          `<description>Some words about it.</description></item>`,
      )
      .join('');
    return `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title>${entries}</channel></rss>`;
  }

  // ── 15.1 / 16a — the URL is refused at save time and at fetch time ────────────────

  describe('a feed address', () => {
    it('is refused at save time when it is not https', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      await tenant
        .as(app.http.post(MARKETING_PATHS.contentFeeds))
        .send({ brandId: brand.id, name: 'Insecure', url: 'http://feeds.example.test/rss' })
        .expect(422);
    });

    it('is refused at save time when it is a private address', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      await tenant
        .as(app.http.post(MARKETING_PATHS.contentFeeds))
        .send({
          brandId: brand.id,
          name: 'Metadata',
          url: 'https://169.254.169.254/latest/meta-data/',
        })
        .expect(422);
    });

    it('is refused at fetch time when the host resolves to a private address', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      // Resolved publicly when it was saved; `127.0.0.1` by the time we poll. This is the case
      // the save-time check cannot catch, and the reason the guard re-resolves every time.
      const url = 'https://feeds.rebind.test/rss';
      outbound().serve(url, rss([{ title: 'Never read', link: 'https://news.test/1' }]));
      const feed = await feedFor(tenant, brand, url);

      outbound().resolveTo('feeds.rebind.test', '127.0.0.1');
      await drainQueue();

      const after = await readFeed(tenant, feed.id);
      expect(after.lastReason).toBe('blocked_address');
      expect(after.entryCount).toBe(0);
      expect(await entriesFor(tenant)).toHaveLength(0);
    });

    it('reports a reason code and nothing from the remote', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      const url = 'https://feeds.broken.test/rss';
      outbound().failWith(url, 'http_error');
      const feed = await feedFor(tenant, brand, url);
      await drainQueue();

      const after = await readFeed(tenant, feed.id);
      expect(after.lastReason).toBe('http_error');
      // The wire shape has no field that could carry a status line, header or body fragment.
      expect(Object.keys(after)).not.toContain('lastError');
      expect(JSON.stringify(after)).not.toContain('169.254');
    });
  });

  // ── 16b / 16g — ingest is idempotent, and it produces drafts ─────────────────────

  describe('ingest', () => {
    it('creates one draft per entry however often the feed is polled', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      const url = 'https://feeds.example.test/rss';
      outbound().serve(
        url,
        rss([
          { title: 'First', link: 'https://news.test/1', guid: 'urn:1' },
          { title: 'Second', link: 'https://news.test/2', guid: 'urn:2' },
        ]),
      );

      const feed = await feedFor(tenant, brand, url);
      await drainQueue();
      expect(await entriesFor(tenant)).toHaveLength(2);

      // The same feed again — and, for good measure, with its items renumbered, which is the
      // case 16g's hashed key exists for.
      outbound().serve(
        url,
        rss([
          { title: 'Second', link: 'https://news.test/2', guid: 'urn:2' },
          { title: 'First', link: 'https://news.test/1', guid: 'urn:1' },
        ]),
      );
      await tenant.as(app.http.post(MARKETING_PATHS.pollContentFeed(feed.id))).expect(201);
      await drainQueue();

      expect(await entriesFor(tenant)).toHaveLength(2);
    });

    it('does not duplicate when a worker dies mid-ingest and the job is re-run', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const companyId = tenant.session.company.id;

      const url = 'https://feeds.example.test/rss';
      outbound().serve(url, rss([{ title: 'Only', link: 'https://news.test/1' }]));
      const feed = await feedFor(tenant, brand, url);

      // The first run ingests and then "dies" before completing its job; the lease reaper hands
      // the job to a second worker, which runs the same ingest again from the top.
      const feeds = app.nest.get(ContentFeedsService);
      const runOnce = () =>
        app.tenancy.runInCompany({ companyId, grants: 'all' }, () =>
          runInWorker(() => feeds.pollFeed(feed.id)),
        );

      await runOnce();
      await runOnce();

      expect(await entriesFor(tenant)).toHaveLength(1);
    });

    it('stores a title containing markup as text', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      await accountFor(tenant, brand, 'instagram');

      const url = 'https://feeds.example.test/rss';
      outbound().serve(
        url,
        rss([
          {
            title: '&lt;script&gt;alert(1)&lt;/script&gt; Ten trends',
            link: 'https://news.test/1',
          },
        ]),
      );

      await feedFor(tenant, brand, url);
      await drainQueue();

      const entries = await entriesFor(tenant);
      expect(entries).toHaveLength(1);
      // The characters, not a node — and nothing anywhere renders this as HTML.
      expect(entries[0]?.title).toBe('<script>alert(1)</script> Ten trends');
      expect(entries[0]?.status).toBe('DRAFT');
    });

    it('drops an entry whose link is not a link a browser could follow', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      const url = 'https://feeds.example.test/rss';
      outbound().serve(
        url,
        rss([
          { title: 'Bad', link: 'javascript:alert(1)' },
          { title: 'Good', link: 'https://news.test/2' },
        ]),
      );

      await feedFor(tenant, brand, url);
      await drainQueue();

      const entries = await entriesFor(tenant);
      expect(entries.map((entry) => entry.title)).toEqual(['Good']);
    });

    it('refuses a document that declares a DTD rather than expanding it', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      const url = 'https://feeds.hostile.test/rss';
      outbound().serve(
        url,
        '<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
          '<rss version="2.0"><channel><item><title>&xxe;</title>' +
          '<link>https://news.test/1</link></item></channel></rss>',
      );

      const feed = await feedFor(tenant, brand, url);
      await drainQueue();

      expect((await readFeed(tenant, feed.id)).lastReason).toBe('parse_error');
      expect(await entriesFor(tenant)).toHaveLength(0);
    });
  });

  // ── 16b / 16h — an entry becomes a draft a person can open ──────────────────────

  describe('a feed entry', () => {
    it('becomes one DRAFT post carrying its provenance, however often the feed is polled', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      await accountFor(tenant, brand, 'instagram');

      const url = 'https://feeds.example.test/rss';
      outbound().serve(url, rss([{ title: 'Ten trends', link: 'https://news.test/1', guid: 'urn:1' }]));
      const feed = await feedFor(tenant, brand, url);
      await drainQueue();

      const posts = await app.prisma.scheduledPost.findMany({ where: { brandId: brand.id } });
      expect(posts).toHaveLength(1);
      // A draft, never a schedule: nothing publishes without a human (16b).
      expect(posts[0]?.status).toBe('DRAFT');
      expect(posts[0]?.sourceFeedId).toBe(feed.id);
      expect(posts[0]?.sourceLink).toBe('https://news.test/1');
      expect(posts[0]?.sourceEntryKey).toHaveLength(64);
      expect(posts[0]?.sourceFetchedAt).toBeInstanceOf(Date);
      expect(posts[0]?.content).toContain('https://news.test/1');

      // The entry now says where it got to, and the serialiser reports the row's own value.
      const entries = await entriesFor(tenant);
      expect(entries[0]?.status).toBe('DRAFT');

      // Poll it again, renumbered: the unique index is the whole mechanism (16b).
      outbound().serve(url, rss([{ title: 'Ten trends', link: 'https://news.test/1', guid: 'urn:1' }]));
      await tenant.as(app.http.post(MARKETING_PATHS.pollContentFeed(feed.id))).expect(201);
      await drainQueue();

      expect(await app.prisma.scheduledPost.count({ where: { brandId: brand.id } })).toBe(1);
    });

    it('waits for a connected account rather than dropping, and drafts on a later poll', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      const url = 'https://feeds.example.test/rss';
      outbound().serve(url, rss([{ title: 'Ten trends', link: 'https://news.test/1', guid: 'urn:1' }]));
      const feed = await feedFor(tenant, brand, url);
      await drainQueue();

      expect(await app.prisma.scheduledPost.count({ where: { brandId: brand.id } })).toBe(0);
      expect((await entriesFor(tenant))[0]?.status).toBe('AWAITING_ACCOUNT');

      await accountFor(tenant, brand, 'instagram');
      outbound().serve(url, rss([{ title: 'Ten trends', link: 'https://news.test/1', guid: 'urn:1' }]));
      await tenant.as(app.http.post(MARKETING_PATHS.pollContentFeed(feed.id))).expect(201);
      await drainQueue();

      expect(await app.prisma.scheduledPost.count({ where: { brandId: brand.id } })).toBe(1);
      expect((await entriesFor(tenant))[0]?.status).toBe('DRAFT');
    });
  });

  // ── 16c — one poller per feed ────────────────────────────────────────────────────

  it('keeps one live poll job per feed however many times polling is asked for', async () => {
    const tenant = await signUp();
    const brand = await brandFor(tenant);

    const url = 'https://feeds.example.test/rss';
    outbound().serve(url, rss([{ title: 'One', link: 'https://news.test/1' }]));
    const feed = await feedFor(tenant, brand, url);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await tenant.as(app.http.post(MARKETING_PATHS.pollContentFeed(feed.id))).expect(201);
    }

    const live = await app.prisma.marketingJob.count({
      where: {
        companyId: tenant.session.company.id,
        type: FEED_POLL_JOB_TYPE,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
    });

    expect(live).toBe(1);
  });

  // ── 15.3 — competitors ──────────────────────────────────────────────────────────

  describe('competitor benchmarking', () => {
    it('refuses a handle that is really a URL', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'instagram', handle: 'https://instagram.com/rival' })
        .expect(422);
    });

    it('validates the handle against the network it belongs to (15d)', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      // Legal on Instagram, where dots are part of a username; not on X, where they are not.
      await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'instagram', handle: 'rival.co_official' })
        .expect(201);

      const refusal = await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'x', handle: 'rival.co_official' })
        .expect(422);
      expect((refusal.body as { fields?: Record<string, string> }).fields?.['handle']).toContain(
        'underscores',
      );

      // And the same value one character too long for X's own limit.
      await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'x', handle: 'sixteencharacter' })
        .expect(422);
    });

    it('captures aggregates, and only aggregates, for a connected network', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      await accountFor(tenant, brand, 'instagram');

      const created = await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'instagram', handle: 'rival_co' })
        .expect(201);
      const competitor = created.body as CompetitorSummary;
      expect(competitor.metricsSupported).toBe(true);

      await drainQueue();

      const listed = await tenant.as(app.http.get(MARKETING_PATHS.competitors)).expect(200);
      const latest = (listed.body as CompetitorListResponse).items[0]?.latestSnapshot;
      // A `numeric(8,4)` crosses the wire as its canonical string, never as a JSON number.
      expect(typeof latest?.engagementRate).toBe('string');
      expect(latest?.engagementRate).toMatch(/^\d+\.\d{4}$/);

      const snapshots = await app.prisma.competitorSnapshot.findMany({
        where: { competitorId: competitor.id },
      });
      expect(snapshots).toHaveLength(1);
      // 15c, verified against the schema rather than against intent.
      expect(Object.keys(snapshots[0] ?? {}).sort()).toEqual([
        'brandId',
        'captureDate',
        'capturedAt',
        'companyId',
        'competitorId',
        'engagementRate',
        'followerCount',
        'id',
        'network',
        'postCount',
      ]);
    });

    it('writes one snapshot per day however often the job runs', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      await accountFor(tenant, brand, 'instagram');
      const companyId = tenant.session.company.id;

      const created = await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'instagram', handle: 'rival_co' })
        .expect(201);
      const competitor = created.body as CompetitorSummary;

      const competitors = app.nest.get(CompetitorsService);
      const capture = () =>
        app.tenancy.runInCompany({ companyId, grants: 'all' }, () =>
          runInWorker(() => competitors.captureSnapshot(competitor.id)),
        );

      expect(await capture()).toBe('captured');
      expect(await capture()).toBe('already_captured_today');

      const snapshots = await app.prisma.competitorSnapshot.count({
        where: { competitorId: competitor.id },
      });
      expect(snapshots).toBe(1);
    });

    it('refuses when the brand has no connected account on that network', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const companyId = tenant.session.company.id;

      const created = await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'instagram', handle: 'rival_co' })
        .expect(201);
      const competitor = created.body as CompetitorSummary;

      const competitors = app.nest.get(CompetitorsService);
      const outcome = await app.tenancy.runInCompany({ companyId, grants: 'all' }, () =>
        runInWorker(() => competitors.captureSnapshot(competitor.id)),
      );

      expect(outcome).toBe('no_connected_account');
      expect(stubAdapter().profileReads).toHaveLength(0);
    });

    it('stores the row and says so when the network exposes no public metrics', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      await accountFor(tenant, brand, 'linkedin');

      const created = await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'linkedin', handle: 'rival-co' })
        .expect(201);
      const competitor = created.body as CompetitorSummary;

      expect(competitor.metricsSupported).toBe(false);

      await drainQueue();
      const snapshots = await app.prisma.competitorSnapshot.count({
        where: { competitorId: competitor.id },
      });
      expect(snapshots).toBe(0);
    });

    it('shrinks the publishing budget, because it is the same budget (15b)', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const account = await accountFor(tenant, brand, 'instagram');
      const companyId = tenant.session.company.id;

      const window = publishingWindowFor('instagram');
      if (!window) throw new Error('Meta has a modelled publishing window');

      const before = await tenant
        .as(app.http.get(`${MARKETING_PATHS.socialAccount(account.id)}/rate-limits`))
        .expect(200);
      expect((before.body as SocialRateLimitStatus).publishing.remaining).toBe(window.cap);

      await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'instagram', handle: 'rival_co' })
        .expect(201);

      await drainQueue();

      // The number the publisher enforces with and the number on the account screen are the
      // same number, and a benchmark read has just come out of it. A reservation row nobody
      // reads would satisfy the old assertion and none of this.
      const after = await tenant
        .as(app.http.get(`${MARKETING_PATHS.socialAccount(account.id)}/rate-limits`))
        .expect(200);
      const status = after.body as SocialRateLimitStatus;
      expect(status.publishing.used).toBe(1);
      expect(status.publishing.remaining).toBe(window.cap - 1);

      const spent = await app.tenancy.runInCompany({ companyId, grants: 'all' }, () =>
        quotaSpentInWindow(app.scoped, account.id, window),
      );
      expect(spent).toBe(1);
    });

    it('counts the first read of a window, rather than seeding it away', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const account = await accountFor(tenant, brand, 'instagram');
      const companyId = tenant.session.company.id;

      const window = publishingWindowFor('instagram');
      if (!window) throw new Error('Meta has a modelled publishing window');

      const created = await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'instagram', handle: 'rival_co' })
        .expect(201);
      const competitor = created.body as CompetitorSummary;

      const competitors = app.nest.get(CompetitorsService);
      const capture = () =>
        app.tenancy.runInCompany({ companyId, grants: 'all' }, () =>
          runInWorker(() => competitors.captureSnapshot(competitor.id)),
        );

      // Seeded a window in the past, the counter rolled itself on the very next reservation
      // and the first read of every window was free — spent against the platform, invisible
      // to us. Two reads, two units, and the second one proves the first survived.
      await capture();
      await capture();

      const spent = await app.tenancy.runInCompany({ companyId, grants: 'all' }, () =>
        quotaSpentInWindow(app.scoped, account.id, window),
      );
      expect(spent).toBe(2);
    });

    it('waits out the platform window after a 429 rather than retrying tomorrow (15f)', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const account = await accountFor(tenant, brand, 'instagram');
      const companyId = tenant.session.company.id;

      const created = await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'instagram', handle: 'rival_co' })
        .expect(201);
      const competitor = created.body as CompetitorSummary;

      // Clear the job the create enqueued, so what is scheduled next is the backoff's doing.
      await app.prisma.marketingJob.deleteMany({
        where: { companyId, type: COMPETITOR_SNAPSHOT_JOB_TYPE },
      });

      stubAdapter().rateLimitNext('instagram', 3 * 24 * 60 * 60);

      const competitors = app.nest.get(CompetitorsService);
      const outcome = await app.tenancy.runInCompany({ companyId, grants: 'all' }, () =>
        runInWorker(() => competitors.captureSnapshot(competitor.id)),
      );

      expect(outcome).toBe('rate_limited');

      const next = await app.prisma.marketingJob.findFirst({
        where: { companyId, type: COMPETITOR_SNAPSHOT_JOB_TYPE },
      });
      // Three days, because that is what the vendor asked for — not the flat day the call site
      // used to invent, and not an immediate retry against a token that is being throttled.
      expect(next?.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 2 * 24 * 60 * 60 * 1000);

      // The platform counted the request it refused, so the reservation stands.
      const window = publishingWindowFor('instagram');
      if (!window) throw new Error('Meta has a modelled publishing window');
      const spent = await app.tenancy.runInCompany({ companyId, grants: 'all' }, () =>
        quotaSpentInWindow(app.scoped, account.id, window),
      );
      expect(spent).toBe(1);
    });

    it('refuses a hand-made snapshot when the brand has connected nothing (15b)', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);

      const created = await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'instagram', handle: 'rival_co' })
        .expect(201);
      const competitor = created.body as CompetitorSummary;

      const refusal = await tenant
        .as(app.http.post(MARKETING_PATHS.snapshotCompetitor(competitor.id)))
        .expect(409);
      expect((refusal.body as { code: string }).code).toBe('competitor_account_missing');
    });

    it('skips the read rather than eating the budget publishing needs', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      const account = await accountFor(tenant, brand, 'instagram');
      const companyId = tenant.session.company.id;

      const created = await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'instagram', handle: 'rival_co' })
        .expect(201);
      const competitor = created.body as CompetitorSummary;

      // Meta's window is 50; the floor reserves half of it for publishing, so 26 posts already
      // through the network leaves a benchmark read with nothing to draw on.
      await app.tenancy.runInCompany({ companyId, grants: 'all' }, async () => {
        for (let index = 0; index < 26; index += 1) {
          await app.scoped.scheduledPost.create({
            data: {
              companyId,
              brandId: brand.id,
              socialAccountId: account.id,
              content: `Published ${index}`,
              scheduledAt: new Date(),
              publishedAt: new Date(),
              status: 'PUBLISHED',
            },
          });
        }
      });

      const competitors = app.nest.get(CompetitorsService);
      const outcome = await app.tenancy.runInCompany({ companyId, grants: 'all' }, () =>
        runInWorker(() => competitors.captureSnapshot(competitor.id)),
      );

      expect(outcome).toBe('quota_reserved_for_publishing');
      expect(stubAdapter().profileReads).toHaveLength(0);
    });

    it('refuses a snapshot request for another company competitor', async () => {
      const owner = await signUp();
      const ownerBrand = await brandFor(owner);
      await accountFor(owner, ownerBrand, 'instagram');

      const created = await owner
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: ownerBrand.id, network: 'instagram', handle: 'rival_co' })
        .expect(201);
      const competitor = created.body as CompetitorSummary;

      const stranger = await signUp();

      await stranger
        .as(app.http.post(MARKETING_PATHS.snapshotCompetitor(competitor.id)))
        .expect(404);

      const visible = await stranger.as(app.http.get(MARKETING_PATHS.competitors)).expect(200);
      expect((visible.body as CompetitorListResponse).items).toHaveLength(0);
    });

    it('keeps one live snapshot job per competitor', async () => {
      const tenant = await signUp();
      const brand = await brandFor(tenant);
      await accountFor(tenant, brand, 'instagram');

      const created = await tenant
        .as(app.http.post(MARKETING_PATHS.competitors))
        .send({ brandId: brand.id, network: 'instagram', handle: 'rival_co' })
        .expect(201);
      const competitor = created.body as CompetitorSummary;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await tenant
          .as(app.http.post(MARKETING_PATHS.snapshotCompetitor(competitor.id)))
          .expect(201);
      }

      const live = await app.prisma.marketingJob.count({
        where: {
          companyId: tenant.session.company.id,
          type: COMPETITOR_SNAPSHOT_JOB_TYPE,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
      });

      expect(live).toBe(1);
    });
  });
});
