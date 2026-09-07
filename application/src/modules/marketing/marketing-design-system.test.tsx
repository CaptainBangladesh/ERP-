import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { http, HttpResponse } from 'msw';
import { MARKETING_PATHS } from '@erp/shared';
import { server } from '../../test/server';
import { renderPage, signedInWith } from '../../test/render';
import { MarketingPage } from './pages/MarketingPage';
import { forgetPublishedBrand } from './brand-context';

/**
 * Ticket 13 — the module built from the system the repository already has.
 *
 * Three kinds of case, and they are deliberately different kinds. The first is a *mechanical*
 * ban, because ADR 0005 says boundaries are enforced by machinery and not by discipline: nine
 * private copies of a modal is what happens when the rule lives in a reviewer's head. The
 * second is interaction — the APG keyboard set is asserted by pressing keys and watching focus
 * move, never by checking that an attribute is present, because the attributes can all be right
 * while the strip does nothing. The third is `jest-axe`, scoped to the surfaces this ticket
 * touched, as the ratchet that stops any of it regressing quietly.
 */

/** Vitest runs with the application workspace as its root. */
const MARKETING_SRC = resolve(process.cwd(), 'src/modules/marketing');

const BRAND = {
  id: 'brand-1',
  name: 'Nike Global',
  slug: 'nike-global',
  logoUrl: null,
  brandColors: null,
  timezone: 'UTC',
  customDomain: null,
  storageQuotaMb: 1000,
  socialAccountsCount: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const OTHER_BRAND = { ...BRAND, id: 'brand-2', name: 'Adidas EU', slug: 'adidas-eu' };

const ACCOUNT = {
  id: 'acc-1',
  brandId: 'brand-1',
  platform: 'instagram' as const,
  accountName: '@nikerunning',
  platformAccountId: 'ig_1',
  maskedAccessToken: '••••••••abcd',
  hasRefreshToken: false,
  tokenExpiresAt: null,
  isTokenExpired: false,
  daysUntilExpiration: null,
  status: 'ACTIVE' as const,
  metadata: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function emptyList() {
  return { items: [], page: { number: 1, size: 25, total: 0, pages: 0 } };
}

function listOf(items: unknown[]) {
  return { items, page: { number: 1, size: 25, total: items.length, pages: 1 } };
}

function post(overrides: Record<string, unknown> = {}) {
  const scheduledAt = new Date(Date.now() + 86_400_000).toISOString();
  return {
    id: 'post-1',
    brandId: 'brand-1',
    socialAccountId: 'acc-1',
    socialAccount: { id: 'acc-1', platform: 'instagram' as const, accountName: '@nikerunning' },
    campaignId: null,
    autolistItemId: null,
    content: 'Global Brand Announcement',
    mediaUrls: [],
    platformConfig: null,
    scheduledAt,
    publishedAt: null,
    status: 'SCHEDULED' as const,
    failureReason: null,
    externalPostId: null,
    metrics: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** The workspace with one brand, one account and one scheduled post behind it. */
function workspace(brands = [BRAND]) {
  server.use(
    http.get(MARKETING_PATHS.marketings, () => HttpResponse.json(emptyList())),
    http.get(MARKETING_PATHS.brands, () => HttpResponse.json(listOf(brands))),
    http.get(MARKETING_PATHS.posts, () => HttpResponse.json(listOf([post()]))),
    http.get(MARKETING_PATHS.jobs, () => HttpResponse.json(emptyList())),
    http.get(MARKETING_PATHS.autolists, () => HttpResponse.json(emptyList())),
    http.get(MARKETING_PATHS.campaigns, () => HttpResponse.json(emptyList())),
    http.get(MARKETING_PATHS.smartLinks, () => HttpResponse.json(emptyList())),
    http.get(MARKETING_PATHS.adSyncs, () => HttpResponse.json(emptyList())),
    http.get(MARKETING_PATHS.forms, () => HttpResponse.json(emptyList())),
    http.get(MARKETING_PATHS.nurtureSequences, () => HttpResponse.json(emptyList())),
    http.get(MARKETING_PATHS.dmFlows, () => HttpResponse.json(emptyList())),
    http.get(MARKETING_PATHS.inboxConversations, () => HttpResponse.json(emptyList())),
    http.get(MARKETING_PATHS.inboxMessages, () => HttpResponse.json(emptyList())),
    http.get(MARKETING_PATHS.trackingSites, () => HttpResponse.json(emptyList())),
    http.get(MARKETING_PATHS.analyticsOverview, () =>
      HttpResponse.json({ totalPageViews: 0, uniqueVisitors: 0, topPages: [], topReferrers: [] }),
    ),
    ...brands.flatMap((brand) => [
      http.get(MARKETING_PATHS.brandSocialAccounts(brand.id), () =>
        HttpResponse.json(listOf([{ ...ACCOUNT, brandId: brand.id }])),
      ),
      http.get(MARKETING_PATHS.expiringAccounts(brand.id), () =>
        HttpResponse.json({ thresholdDays: 7, accounts: [] }),
      ),
    ]),
  );
}

describe('marketing: design system, navigation and accessibility', () => {
  beforeEach(() => {
    forgetPublishedBrand();
    window.localStorage.clear();
  });

  // ── 13.1a The ban ────────────────────────────────────────────────────────────────

  describe('the shared dialog is adopted, not re-implemented', () => {
    /**
     * Nine components hand-rolled `fixed inset-0` while `@erp/shared/ui` exported a `Modal` that
     * already carried Escape, the focus trap, focus restore and the body-scroll lock. The point
     * of banning the literal rather than fixing the nine is component ten: a reviewer does not
     * catch a tenth private backdrop, and a private backdrop is where those four behaviours get
     * quietly re-broken one at a time.
     */
    it('has no hand-rolled overlay or dialog anywhere under the module', () => {
      const offenders: string[] = [];

      for (const file of sourceFiles(MARKETING_SRC)) {
        const source = readFileSync(file, 'utf8');
        const relative = file.slice(MARKETING_SRC.length).replace(/\\/g, '/');
        // This file names both literals in order to ban them; it is the one exemption.
        if (relative.endsWith('marketing-design-system.test.tsx')) continue;

        if (source.includes('fixed inset-0')) offenders.push(`${relative}: fixed inset-0`);
        if (/role=("|'|\{')dialog/.test(source)) offenders.push(`${relative}: role="dialog"`);
      }

      expect(offenders).toEqual([]);
    });

    it('renders the shared Modal when a marketing dialog opens', async () => {
      workspace();
      const { user } = renderPage(<MarketingPage />, { path: '/marketing/vault' });

      await user.click(await screen.findByRole('button', { name: /new brand/i }));

      // Asserting `Modal` is what rendered discharges 13.3's dialog work: Escape, the trap,
      // focus restore and the scroll lock are the package's behaviour and the package's tests.
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('heading', { name: /create client brand/i })).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });
  });

  // ── 13.2 Navigation and brand context ────────────────────────────────────────────

  describe('navigation', () => {
    it('selects the tab named by the URL rather than the default', async () => {
      workspace();
      renderPage(<MarketingPage />, { path: '/marketing/queue' });

      expect(await screen.findByRole('tab', { name: /Queue & Tasks/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('writes the tab into the URL so it can be linked and gone back to', async () => {
      workspace();
      const { user } = renderPage(<MarketingPage />, { path: '/marketing/vault' });

      await user.click(await screen.findByRole('tab', { name: /Queue & Tasks/i }));

      await waitFor(() => expect(window.location.pathname).toBe('/marketing/queue'));
    });

    /**
     * The segment is matched against the `TABS` allowlist and nothing else, so an unrecognised
     * one is not an error page and — more to the point — is never echoed back into the DOM.
     */
    it('falls back to the default tab and corrects the URL for an unknown segment', async () => {
      workspace();
      renderPage(<MarketingPage />, { path: '/marketing/<script>alert(1)</script>' });

      expect(await screen.findByRole('tab', { name: /Brand & OAuth Vault/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await waitFor(() => expect(window.location.pathname).toBe('/marketing/vault'));
      expect(document.body.textContent).not.toContain('alert(1)');
    });

    it('deletes the Campaign Records tab but keeps the records URL reachable', async () => {
      workspace();
      renderPage(<MarketingPage />, { path: '/marketing/records' });

      expect(await screen.findByRole('tab', { name: /Queue & Tasks/i })).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /Campaign Records/i })).not.toBeInTheDocument();
      // The scaffold's own screen is still what that address shows.
      expect(screen.getByRole('heading', { name: /add a marketing/i })).toBeInTheDocument();
    });
  });

  describe('brand context', () => {
    it('carries the active brand in the URL so a shared link keeps its client', async () => {
      workspace([BRAND, OTHER_BRAND]);
      renderPage(<MarketingPage />, { path: '/marketing/vault?brand=brand-2' });

      expect((await screen.findAllByText('Adidas EU')).length).toBeGreaterThan(0);
      expect(window.location.search).toContain('brand=brand-2');
    });

    /**
     * The URL proposes; the list the API returned for this session disposes. An id that is not
     * in it — a stale link, somebody else's brand, a crafted one — falls back and the URL is
     * rewritten, and nothing about the rejected brand is ever rendered.
     */
    it('refuses a brand the API did not return, and rewrites the URL', async () => {
      workspace([BRAND]);
      renderPage(<MarketingPage />, { path: '/marketing/vault?brand=brand-somebody-elses' });

      expect((await screen.findAllByText('Nike Global')).length).toBeGreaterThan(0);
      await waitFor(() => expect(window.location.search).toBe('?brand=brand-1'));
      expect(document.body.textContent).not.toContain('brand-somebody-elses');
    });

    it('persists the active brand against the signed-in user, and survives a reload', async () => {
      signedInWith();
      workspace([BRAND, OTHER_BRAND]);

      const first = renderPage(<MarketingPage />, {
        path: '/marketing/vault?brand=brand-2',
        token: 't',
      });
      await waitFor(() =>
        expect(window.localStorage.getItem('marketing:activeBrand:u1')).toBe('brand-2'),
      );
      first.unmount();

      // A reload arrives with no brand in the URL; storage is what remembers the client.
      renderPage(<MarketingPage />, { path: '/marketing/vault', token: 't' });
      expect((await screen.findAllByText('Adidas EU')).length).toBeGreaterThan(0);
    });
  });

  // ── 13.3a APG Tabs ───────────────────────────────────────────────────────────────

  describe('the tab strip follows the APG Tabs pattern', () => {
    it('moves with Left/Right and wraps, and Home/End reach the ends', async () => {
      workspace();
      const { user } = renderPage(<MarketingPage />, { path: '/marketing/calendar' });

      const strip = await screen.findByRole('tablist', { name: /marketing sections/i });
      const tabs = within(strip).getAllByRole('tab');
      const [first, second] = tabs;
      const last = tabs[tabs.length - 1];

      first!.focus();
      await user.keyboard('{ArrowRight}');
      expect(second).toHaveFocus();
      expect(second).toHaveAttribute('aria-selected', 'true');
      expect(first).toHaveAttribute('aria-selected', 'false');

      // Wraps backwards off the start rather than stopping dead.
      first!.focus();
      await user.keyboard('{ArrowLeft}');
      expect(last).toHaveFocus();

      await user.keyboard('{Home}');
      expect(first).toHaveFocus();

      await user.keyboard('{End}');
      expect(last).toHaveFocus();
    });

    it('announces the strip as one group with a panel each tab controls', async () => {
      workspace();
      renderPage(<MarketingPage />, { path: '/marketing/queue' });

      const selected = await screen.findByRole('tab', { name: /Queue & Tasks/i });
      const panel = screen.getByRole('tabpanel');

      expect(selected).toHaveAttribute('aria-controls', panel.id);
      expect(panel).toHaveAttribute('aria-labelledby', selected.id);
      // Roving tabindex: one stop for the strip, arrows inside it.
      expect(selected).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('tab', { name: /Calendar & Planner/i })).toHaveAttribute(
        'tabindex',
        '-1',
      );
    });
  });

  // ── 13.3b Rescheduling by drag and by keyboard ───────────────────────────────────

  describe('rescheduling a post', () => {
    /**
     * The test the module never had. A keyboard-only user could not reschedule at all — the
     * calendar's only affordance was HTML5 `draggable`, which is ticket 05's headline feature
     * unavailable to them. Both paths must reach the same `PATCH /posts/:id`.
     */
    it('reaches PATCH /posts/:id from the keyboard, with the server deciding the time', async () => {
      workspace();

      const patched: Array<Record<string, unknown>> = [];
      server.use(
        http.patch(MARKETING_PATHS.post('post-1'), async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          patched.push(body);
          return HttpResponse.json(post({ scheduledAt: body.scheduledAt as string }));
        }),
      );

      const { user } = renderPage(<MarketingPage />, { path: '/marketing/calendar' });

      const trigger = await screen.findByRole('button', { name: /^Reschedule post:/i });
      // Tab-reachable and activated by the keyboard, which is the whole point.
      trigger.focus();
      await user.keyboard('{Enter}');

      const dialog = await screen.findByRole('dialog');
      const field = within(dialog).getByLabelText(/new date and time/i);
      await user.clear(field);
      await user.type(field, '2031-01-02T09:30');
      await user.click(within(dialog).getByRole('button', { name: /^Reschedule$/i }));

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(new Date(patched[0]!.scheduledAt as string).getFullYear()).toBe(2031);
    });

    it('renders the server refusal rather than deciding for itself what is legal', async () => {
      workspace();
      server.use(
        http.patch(MARKETING_PATHS.post('post-1'), () =>
          HttpResponse.json(
            { code: 'invalid_scheduled_at', message: 'A post cannot be scheduled in the past.' },
            { status: 400 },
          ),
        ),
      );

      const { user } = renderPage(<MarketingPage />, { path: '/marketing/calendar' });

      await user.click(await screen.findByRole('button', { name: /^Reschedule post:/i }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: /^Reschedule$/i }));

      expect(await screen.findByText(/cannot be scheduled in the past/i)).toBeInTheDocument();
    });
  });

  // ── 13.3c The axe ratchet ────────────────────────────────────────────────────────

  describe('accessibility', () => {
    const surfaces = [
      ['/marketing/vault', /Encrypted OAuth Credential Vault/i],
      ['/marketing/calendar', /Today/i],
      ['/marketing/publishing', /Schedule Post/i],
      ['/marketing/queue', /Total Tasks/i],
      ['/marketing/records', /Add a marketing/i],
    ] as const;

    for (const [path, ready] of surfaces) {
      it(`reports no violations on ${path}`, async () => {
        workspace();
        const { container } = renderPage(<MarketingPage />, { path });

        // Wait for the surface's own content, not just for the shell: an empty div passes axe.
        await screen.findByText(ready);

        const results = await axe(container);
        expect(results.violations.map((violation) => violation.id)).toEqual([]);
      });
    }
  });
});

/** Every `.ts`/`.tsx` under the module, tests included. */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}
