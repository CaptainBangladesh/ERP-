import {
  OUTBOUND_MAX_REDIRECTS,
  StubOutboundFetchService,
  isPublicAddress,
  validateOutboundTarget,
  type AddressResolver,
} from '../src/modules/marketing/outbound-fetch.service';
import { runInWorker } from '../src/modules/marketing/worker-context';

/**
 * Ticket 15.1 — the fetch guard, at the unit level.
 *
 * These are claims about a decision made before a socket opens, so they are asserted below the
 * HTTP seam: there is no endpoint that fetches, by design (14-17.0), and a test that drove one
 * over HTTP would be testing a route that must not exist.
 */
describe('OutboundFetchService: the guard around an operator-supplied URL', () => {
  /** Answers whatever the test says the DNS answered — including a rebind. */
  function resolvingTo(...addresses: string[]): AddressResolver {
    return async () =>
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  }

  describe('the address check (14-17.0, 14-17.0a)', () => {
    it('refuses http:, which readLinkUrl allows for a rendered link', async () => {
      const check = await validateOutboundTarget('http://example.test/feed.xml');
      expect(check).toEqual({ ok: false, reason: 'blocked_scheme' });
    });

    it('refuses a port that is not 443, because :9200 behind a public name is still :9200', async () => {
      const check = await validateOutboundTarget('https://example.test:9200/_search');
      expect(check).toEqual({ ok: false, reason: 'blocked_scheme' });
    });

    it.each([
      ['loopback', 'https://127.0.0.1/feed.xml'],
      ['the metadata endpoint', 'https://169.254.169.254/latest/meta-data/'],
      ['RFC1918', 'https://10.1.2.3/feed.xml'],
      ['RFC1918 (172.16/12)', 'https://172.20.0.5/feed.xml'],
      ['RFC1918 (192.168/16)', 'https://192.168.1.1/feed.xml'],
      ['the unspecified address', 'https://0.0.0.0/feed.xml'],
      ['IPv6 loopback', 'https://[::1]/feed.xml'],
      ['an IPv6 ULA', 'https://[fc00::1]/feed.xml'],
    ])('refuses %s', async (_label, url) => {
      const check = await validateOutboundTarget(url);
      expect(check).toEqual({ ok: false, reason: 'blocked_address' });
    });

    it('refuses a public *name* that resolves to a private address', async () => {
      const check = await validateOutboundTarget(
        'https://feeds.example.test/rss',
        resolvingTo('127.0.0.1'),
      );
      expect(check).toEqual({ ok: false, reason: 'blocked_address' });
    });

    it('pins the surviving address, so the checked address is the connected one', async () => {
      const check = await validateOutboundTarget(
        'https://feeds.example.test/rss',
        // A rebind-shaped answer: one private, one public. Only the public one may be used.
        resolvingTo('10.0.0.7', '93.184.216.34'),
      );

      expect(check.ok).toBe(true);
      if (!check.ok) return;
      expect(check.target.address).toBe('93.184.216.34');
      expect(check.target.url.hostname).toBe('feeds.example.test');
    });

    it('refuses a name that does not resolve at all', async () => {
      const check = await validateOutboundTarget('https://feeds.example.test/rss', async () => {
        throw new Error('ENOTFOUND');
      });
      expect(check).toEqual({ ok: false, reason: 'blocked_address' });
    });

    it('classifies the ranges directly', () => {
      expect(isPublicAddress('93.184.216.34')).toBe(true);
      expect(isPublicAddress('100.64.0.1')).toBe(false); // carrier NAT
      expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false); // v4-mapped loopback
      expect(isPublicAddress('fe80::1')).toBe(false); // link-local
      expect(isPublicAddress('2606:2800:220:1::')).toBe(true);
    });
  });

  describe('the caller-facing contract', () => {
    let guard: StubOutboundFetchService;

    beforeEach(() => {
      guard = new StubOutboundFetchService();
    });

    it('refuses to run outside a queue worker (14-17.0)', async () => {
      await expect(guard.fetch({ url: 'https://feeds.example.test/rss' })).rejects.toThrow(
        /outside a queue worker/i,
      );
    });

    it('refuses a redirect chain at the hop that lands on a private address (14-17.0b)', async () => {
      guard.redirect('https://feeds.example.test/rss', 'https://169.254.169.254/latest/meta-data/');
      // The document behind the private hop exists; the point is that it is never read.
      guard.serve('https://169.254.169.254/latest/meta-data/', 'secrets');

      const result = await runInWorker(() =>
        guard.fetch({ url: 'https://feeds.example.test/rss' }),
      );

      expect(result).toEqual({ ok: false, reason: 'blocked_address' });
    });

    it('stops after three hops', async () => {
      for (let hop = 0; hop <= OUTBOUND_MAX_REDIRECTS + 1; hop += 1) {
        guard.redirect(`https://a${hop}.example.test/`, `https://a${hop + 1}.example.test/`);
      }

      const result = await runInWorker(() => guard.fetch({ url: 'https://a0.example.test/' }));
      expect(result).toEqual({ ok: false, reason: 'too_many_redirects' });
    });

    it('refuses a body over the cap', async () => {
      guard.serve('https://feeds.example.test/rss', 'x'.repeat(4096));

      const result = await runInWorker(() =>
        guard.fetch({ url: 'https://feeds.example.test/rss', maxBytes: 1024 }),
      );

      expect(result).toEqual({ ok: false, reason: 'too_large' });
    });

    it('returns a reason code and nothing from the remote (14-17.0d)', async () => {
      guard.failWith('https://feeds.example.test/rss', 'http_error');

      const result = await runInWorker(() =>
        guard.fetch({ url: 'https://feeds.example.test/rss' }),
      );

      expect(result).toEqual({ ok: false, reason: 'http_error' });
      // The refusal has exactly one field beside `ok`: no status line, no header, no body
      // fragment, no resolved address is reachable from here.
      expect(Object.keys(result).sort()).toEqual(['ok', 'reason']);
    });
  });
});
