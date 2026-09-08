import { Injectable, Logger } from '@nestjs/common';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';
import type { OutboundFetchReason } from '@erp/shared';
import { isInsideWorker } from './worker-context';

/** 14-17.0c: 2 MB of body, measured after decompression, and a 10s wall clock over the chain. */
export const OUTBOUND_MAX_BYTES = 2 * 1024 * 1024;
export const OUTBOUND_DEADLINE_MS = 10_000;

/** 14-17.0b: at most three hops, each one re-validated from the top. */
export const OUTBOUND_MAX_REDIRECTS = 3;

/**
 * 14-17.0e: one in-flight request per remote host, and a ceiling across the module.
 *
 * A queue with no fan-out limit turns a list of operator-supplied URLs into a small DoS engine
 * pointed at a third party, and — when a host is slow — into an exhaustion of our own workers.
 */
export const OUTBOUND_MAX_INFLIGHT = 4;

export interface OutboundFetchSuccess {
  readonly ok: true;
  readonly body: Buffer;
  /** The vendor's claim about the type. Never trusted for anything but a hint (17g). */
  readonly contentTypeHeader?: string;
  /** The final URL of the chain, ours to log because it is a value we validated. */
  readonly finalUrl: string;
}

export interface OutboundFetchRefusal {
  readonly ok: false;
  /**
   * The closed code, and the only thing anybody is told (14-17.0d). No status line, no header,
   * no body fragment, no resolved address — a "feed error" panel that echoes what came back
   * from `169.254.169.254` is an exfiltration channel with a UI.
   */
  readonly reason: OutboundFetchReason;
}

export type OutboundFetchResult = OutboundFetchSuccess | OutboundFetchRefusal;

/** A host that survived the range check, with the one address we will actually connect to. */
export interface ValidatedTarget {
  readonly url: URL;
  readonly address: string;
  readonly family: 4 | 6;
}

export type TargetCheck =
  | { readonly ok: true; readonly target: ValidatedTarget }
  | { readonly ok: false; readonly reason: OutboundFetchReason };

/** What the guard is asked to fetch. The caller never supplies headers, a method or a body. */
export interface OutboundFetchRequest {
  readonly url: string;
  /** An `Accept` hint only — no cookies, no `Authorization`, ever (14-17.0). */
  readonly accept?: string;
  readonly maxBytes?: number;
}

/**
 * Outbound HTTP for the marketing module, and the only way out of it (14-17.0).
 *
 * Three features here fetch a URL an operator supplied — feeds, and later the editor's asset
 * export — and a scheduled server-side fetch of a user-supplied URL is the classic SSRF pivot
 * on a backend that sits next to Postgres and a cloud metadata endpoint. So there is one seam,
 * it is abstract, and nothing else in the module calls `fetch()` with a non-constant host.
 *
 * The rules it enforces, all of them at fetch time on every call rather than once at save
 * time — a hostname that resolved publicly yesterday resolves to `127.0.0.1` today:
 *
 *  - `https:` on port 443 only. Not `http:`, despite `readLinkUrl` permitting it for
 *    *rendered* links: rendering and fetching are different trust decisions.
 *  - We resolve the host ourselves, filter the answers, pick a surviving address and connect
 *    to that literal IP with the hostname carried in `Host` and in TLS SNI (14-17.0a), so the
 *    address that passed the check is the address the socket opens. A resolve-then-fetch-by-
 *    name sequence re-resolves inside the client, and a DNS rebind walks straight through it.
 *  - Redirects are followed by us, one hop at a time, each `Location` re-entering the whole
 *    check from the top (14-17.0b). `redirect: 'manual'` is not an optimisation here: if the
 *    client follows, the private-address hop has already been requested by the time we look.
 *  - Bytes are counted after decompression (14-17.0c). A cap read off `Content-Length` is a
 *    cap the attacker sets, and 2 MB of gzip is gigabytes of heap.
 *  - Refusals are a closed enum (14-17.0d), never the remote's own words.
 */
export abstract class OutboundFetchService {
  abstract fetch(request: OutboundFetchRequest): Promise<OutboundFetchResult>;
}

/**
 * Does this address belong to somebody other than us?
 *
 * Written as an allowlist of "public" by exclusion of every range that is not, because the
 * list of things worth refusing is the one that grows: loopback, link-local (which is where
 * the cloud metadata endpoint lives), RFC1918, carrier NAT, ULA, multicast and the
 * unspecified address.
 */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return false; // 0.0.0.0/8, including the unspecified address itself
  if (a === 10) return false; // RFC1918
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local — the metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
  if (a === 192 && b === 168) return false; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return false; // RFC6598 carrier NAT
  if (a === 192 && b === 0) return false; // 192.0.0.0/24 and TEST-NET-1
  if (a >= 224) return false; // multicast and reserved
  return true;
}

function isPublicIpv6(address: string): boolean {
  const value = address.toLowerCase().split('%')[0] ?? '';

  if (value === '::' || value === '::1') return false;
  // IPv4-mapped and IPv4-compatible forms carry a v4 address; judge it as one.
  const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped?.[1]) return isPublicIpv4(mapped[1]);

  if (/^f[cd]/.test(value)) return false; // ULA fc00::/7
  if (/^fe[89ab]/.test(value)) return false; // link-local fe80::/10
  if (/^ff/.test(value)) return false; // multicast
  return true;
}

/** How a hostname becomes addresses. Injected so the check itself stays testable offline. */
export type AddressResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export const systemResolver: AddressResolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });

/**
 * The whole of 14-17.0's check, in one function, so that a redirect hop re-enters exactly what
 * the first request went through — not a cheaper cousin of it.
 */
export async function validateOutboundTarget(
  raw: string | URL,
  resolver: AddressResolver = systemResolver,
): Promise<TargetCheck> {
  let url: URL;
  try {
    url = raw instanceof URL ? raw : new URL(raw);
  } catch {
    return { ok: false, reason: 'blocked_scheme' };
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'blocked_scheme' };
  // Port is part of the check: an internal service on `:9200` behind a public DNS name defeats
  // a range check that only looks at the address.
  if (url.port !== '' && url.port !== '443') return { ok: false, reason: 'blocked_scheme' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'blocked_scheme' };

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === '') return { ok: false, reason: 'blocked_address' };

  let answers: Array<{ address: string; family: number }>;
  if (isIP(hostname) !== 0) {
    answers = [{ address: hostname, family: isIP(hostname) }];
  } else {
    try {
      answers = await resolver(hostname);
    } catch {
      // A name that does not resolve is not an address we may connect to.
      return { ok: false, reason: 'blocked_address' };
    }
  }

  const survivor = answers.find((answer) => isPublicAddress(answer.address));
  if (!survivor) return { ok: false, reason: 'blocked_address' };

  return {
    ok: true,
    target: {
      url,
      address: survivor.address,
      family: isIP(survivor.address) === 6 ? 6 : 4,
    },
  };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * The live guard: real sockets, real DNS, our own redirect loop.
 *
 * `node:https` rather than `fetch` for one reason that matters: the `lookup` hook is what lets
 * the validated address be the connected address (14-17.0a). `fetch` re-resolves inside undici
 * and offers no seam to pin it.
 */
@Injectable()
export class LiveOutboundFetchService extends OutboundFetchService {
  private readonly logger = new Logger('MarketingOutboundFetch');

  /** 14-17.0e, both halves: one slot per host, and a ceiling over all of them. */
  private readonly inFlightHosts = new Set<string>();
  private inFlightTotal = 0;
  private readonly waiting: Array<() => void> = [];

  async fetch(request: OutboundFetchRequest): Promise<OutboundFetchResult> {
    assertWorker();

    const deadline = Date.now() + OUTBOUND_DEADLINE_MS;
    const maxBytes = request.maxBytes ?? OUTBOUND_MAX_BYTES;

    let next: string | URL = request.url;

    for (let hop = 0; hop <= OUTBOUND_MAX_REDIRECTS; hop += 1) {
      const check = await validateOutboundTarget(next);
      if (!check.ok) return this.refuse(request.url, check.reason);

      if (Date.now() >= deadline) return this.refuse(request.url, 'timeout');

      const attempt = await this.withSlot(check.target.url.hostname, () =>
        this.send(check.target, request.accept, maxBytes, deadline),
      );

      if (attempt.kind === 'refused') return this.refuse(request.url, attempt.reason);
      if (attempt.kind === 'body') {
        return {
          ok: true,
          body: attempt.body,
          ...(attempt.contentType ? { contentTypeHeader: attempt.contentType } : {}),
          finalUrl: check.target.url.toString(),
        };
      }

      // A redirect. Resolve it against the URL we actually asked, and go round again — the
      // next iteration re-runs the full check before a single byte is sent to the new host.
      try {
        next = new URL(attempt.location, check.target.url);
      } catch {
        return this.refuse(request.url, 'blocked_address');
      }
    }

    return this.refuse(request.url, 'too_many_redirects');
  }

  /**
   * One request, no redirect following, headers rebuilt from scratch.
   *
   * Nothing is carried across a hop — no cookie jar, no `Authorization`, no referer — because
   * a header that survives a cross-host jump is a credential handed to whoever the redirect
   * chose (14-17.0b).
   */
  private send(
    target: ValidatedTarget,
    accept: string | undefined,
    maxBytes: number,
    deadline: number,
  ): Promise<
    | { kind: 'body'; body: Buffer; contentType?: string }
    | { kind: 'redirect'; location: string }
    | { kind: 'refused'; reason: OutboundFetchReason }
  > {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (
        outcome:
          | { kind: 'body'; body: Buffer; contentType?: string }
          | { kind: 'redirect'; location: string }
          | { kind: 'refused'; reason: OutboundFetchReason },
      ): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        resolve({ kind: 'refused', reason: 'timeout' });
        return;
      }

      const options: RequestOptions = {
        protocol: 'https:',
        // The hostname is what TLS verifies and what `Host` carries; `lookup` decides where
        // the socket actually goes, and it answers with the one address we validated.
        host: target.url.hostname,
        servername: target.url.hostname,
        port: 443,
        method: 'GET',
        path: `${target.url.pathname}${target.url.search}`,
        headers: {
          host: target.url.host,
          accept: accept ?? '*/*',
          // Decompression is ours to do, so the byte counter sees expanded bytes (14-17.0c).
          'accept-encoding': 'identity',
          'user-agent': 'ERP-Marketing-Feed/1.0',
        },
        lookup: (_hostname, _opts, callback) => {
          (callback as (err: Error | null, address: string, family: number) => void)(
            null,
            target.address,
            target.family,
          );
        },
      };

      const req = httpsRequest(options, (res) => {
        const status = res.statusCode ?? 0;

        if (REDIRECT_STATUSES.has(status)) {
          const location = res.headers.location;
          res.destroy();
          if (typeof location !== 'string' || location.trim() === '') {
            finish({ kind: 'refused', reason: 'http_error' });
            return;
          }
          finish({ kind: 'redirect', location: location.trim() });
          return;
        }

        if (status < 200 || status >= 300) {
          res.destroy();
          finish({ kind: 'refused', reason: 'http_error' });
          return;
        }

        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
        const stream = decompressed(res, encoding);
        if (!stream) {
          res.destroy();
          finish({ kind: 'refused', reason: 'parse_error' });
          return;
        }

        const chunks: Buffer[] = [];
        let seen = 0;

        stream.on('data', (chunk: Buffer) => {
          seen += chunk.length;
          if (seen > maxBytes) {
            // Abort the socket rather than the stream: the point is to stop paying for bytes,
            // not to read them all and then complain.
            req.destroy();
            res.destroy();
            finish({ kind: 'refused', reason: 'too_large' });
            return;
          }
          chunks.push(chunk);
        });

        stream.on('error', () => {
          req.destroy();
          finish({ kind: 'refused', reason: 'parse_error' });
        });

        stream.on('end', () => {
          const contentType = res.headers['content-type'];
          finish({
            kind: 'body',
            body: Buffer.concat(chunks),
            ...(typeof contentType === 'string' ? { contentType } : {}),
          });
        });
      });

      const timer = setTimeout(() => {
        req.destroy();
        finish({ kind: 'refused', reason: 'timeout' });
      }, remaining);

      req.on('error', () => {
        finish({ kind: 'refused', reason: 'http_error' });
      });

      req.end();
    });
  }

  /** Per-host exclusivity and the global ceiling, as one gate (14-17.0e). */
  private async withSlot<T>(hostname: string, work: () => Promise<T>): Promise<T> {
    while (this.inFlightHosts.has(hostname) || this.inFlightTotal >= OUTBOUND_MAX_INFLIGHT) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }

    this.inFlightHosts.add(hostname);
    this.inFlightTotal += 1;
    try {
      return await work();
    } finally {
      this.inFlightHosts.delete(hostname);
      this.inFlightTotal -= 1;
      this.waiting.splice(0).forEach((wake) => wake());
    }
  }

  /** The log line carries the code and the URL the operator typed. Nothing from the remote. */
  private refuse(requested: string, reason: OutboundFetchReason): OutboundFetchRefusal {
    this.logger.warn(`Outbound fetch refused (${reason}): ${requested}`);
    return { ok: false, reason };
  }
}

function decompressed(source: Readable, encoding: string): Readable | undefined {
  if (encoding === '' || encoding === 'identity') return source;
  if (encoding === 'gzip' || encoding === 'x-gzip') return source.pipe(createGunzip());
  if (encoding === 'deflate') return source.pipe(createInflate());
  if (encoding === 'br') return source.pipe(createBrotliDecompress());
  return undefined;
}

/**
 * The test double, which enforces the same check and then serves canned bytes.
 *
 * It shares `validateOutboundTarget` with the live service on purpose: a stub that answered
 * "here is your feed" for `https://127.0.0.1/feed.xml` would make the SSRF tests assert
 * against the stub's manners rather than the guard's rule.
 */
@Injectable()
export class StubOutboundFetchService extends OutboundFetchService {
  private readonly documents = new Map<string, { body: Buffer; contentType?: string }>();
  private readonly redirects = new Map<string, string>();
  private readonly failures = new Map<string, OutboundFetchReason>();
  private readonly addresses = new Map<string, string>();
  /** Every URL the module asked for, so a test can assert the fetch happened at all. */
  readonly requested: string[] = [];

  serve(url: string, body: string | Buffer, contentType = 'application/rss+xml'): void {
    this.documents.set(url, {
      body: typeof body === 'string' ? Buffer.from(body, 'utf8') : body,
      contentType,
    });
  }

  redirect(from: string, to: string): void {
    this.redirects.set(from, to);
  }

  failWith(url: string, reason: OutboundFetchReason): void {
    this.failures.set(url, reason);
  }

  /**
   * What DNS says about a host in this test.
   *
   * The default is a public TEST-NET address, because a suite has no network and every
   * unregistered name would otherwise fail as `blocked_address` for the wrong reason. Point a
   * host at `127.0.0.1` to exercise the rebind case: the same `validateOutboundTarget` the
   * live service uses is what then refuses it.
   */
  resolveTo(hostname: string, address: string): void {
    this.addresses.set(hostname, address);
  }

  reset(): void {
    this.documents.clear();
    this.redirects.clear();
    this.failures.clear();
    this.addresses.clear();
    this.requested.length = 0;
  }

  private readonly resolver: AddressResolver = async (hostname) => {
    const address = this.addresses.get(hostname) ?? '203.0.113.10';
    return [{ address, family: address.includes(':') ? 6 : 4 }];
  };

  async fetch(request: OutboundFetchRequest): Promise<OutboundFetchResult> {
    assertWorker();
    this.requested.push(request.url);

    let current = request.url;
    for (let hop = 0; hop <= OUTBOUND_MAX_REDIRECTS; hop += 1) {
      const check = await validateOutboundTarget(current, this.resolver);
      if (!check.ok) return { ok: false, reason: check.reason };

      const key = check.target.url.toString();
      const failure = this.failures.get(key) ?? this.failures.get(current);
      if (failure) return { ok: false, reason: failure };

      const hopTo = this.redirects.get(key) ?? this.redirects.get(current);
      if (hopTo) {
        current = new URL(hopTo, check.target.url).toString();
        continue;
      }

      const document = this.documents.get(key) ?? this.documents.get(current);
      if (!document) return { ok: false, reason: 'http_error' };

      if (document.body.length > (request.maxBytes ?? OUTBOUND_MAX_BYTES)) {
        return { ok: false, reason: 'too_large' };
      }

      return {
        ok: true,
        body: document.body,
        ...(document.contentType ? { contentTypeHeader: document.contentType } : {}),
        finalUrl: key,
      };
    }

    return { ok: false, reason: 'too_many_redirects' };
  }
}

/**
 * A programming mistake, not a fetch outcome, so it throws rather than returning a code: the
 * fix is to move the call onto the queue, and a refusal code would let it ship as an empty
 * panel instead.
 */
function assertWorker(): void {
  if (isInsideWorker()) return;
  throw new Error(
    'OutboundFetchService was called outside a queue worker. Every outbound fetch in this ' +
      'module runs on the queue (14-17.0), so a slow remote host cannot occupy an HTTP thread.',
  );
}
