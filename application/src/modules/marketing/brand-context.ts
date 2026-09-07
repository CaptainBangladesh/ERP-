import type { BrandSummary } from '@erp/shared';

/**
 * Which client's workspace the marketing screens are pointed at.
 *
 * This is the one piece of state in the module that is a safety control rather than a
 * preference. Every panel downstream takes the brand it names and drives credentialed
 * publishing with it, so "publish to the wrong client's Instagram" — the worst thing this
 * product can do, and not undoable — is one wrong value here away.
 *
 * The brand now travels in the URL so a colleague can share a link to a brand's calendar, and
 * it is persisted so a reload does not silently move you to `brands[0]`. Both of those turn the
 * identifier into input somebody else can supply. So neither is ever treated as authority: they
 * *propose* a brand, and the list the API returned for this session *disposes* — see
 * `resolveActiveBrand`.
 */

/** Only the opaque id is ever written down. No name, slug, handle, or token. */
const STORAGE_PREFIX = 'marketing:activeBrand:';

/** The query parameter a shared link carries. */
export const BRAND_QUERY_PARAM = 'brand';

export function storedBrandId(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

/**
 * Keyed by the signed-in user, not by the module alone.
 *
 * The session lives in `localStorage`, so two people sharing a machine share this origin's
 * storage. An unnamespaced key would hand the second one the first one's brand — which is to
 * say, the first one's client — and nothing on screen would look wrong.
 */
export function rememberBrandId(userId: string | undefined, brandId: string): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, brandId);
  } catch {
    // A choice that cannot be remembered is still a choice that works until reload.
  }
}

/**
 * The URL proposes, the server disposes.
 *
 * An id is accepted only if it is in the list the API returned for this session; anything else
 * — a stale link, a colleague's brand, a crafted one — falls back to the default and the caller
 * rewrites the URL. Nothing is ever constructed out of a URL value: the brand rendered on screen
 * is an object the server sent, so a name or logo cannot be supplied by whoever wrote the link.
 */
export function resolveActiveBrand(
  brands: readonly BrandSummary[],
  proposals: ReadonlyArray<string | null | undefined>,
): { brand: BrandSummary | null; wasProposalHonoured: boolean } {
  const firstProposal = proposals.find((value) => Boolean(value)) ?? null;

  for (const proposal of proposals) {
    if (!proposal) continue;
    const match = brands.find((brand) => brand.id === proposal);
    // A proposal that resolves is honoured whether it came from the URL or from storage.
    if (match) return { brand: match, wasProposalHonoured: true };
  }

  return {
    brand: brands[0] ?? null,
    // No proposal at all is not a correction; a proposal that failed to resolve is, and the
    // caller uses that to rewrite the URL with `replace`. A stored id that fails is simply
    // discarded — silently, because there is nothing the person could do about it.
    wasProposalHonoured: firstProposal === null,
  };
}

/**
 * The brand this session last published to.
 *
 * Deliberately module state and not storage: the confirmation exists to catch "I was working on
 * Nike and I am now looking at Adidas", which is a question about *this sitting*. Persisting it
 * would mean the first publish after every reload is unconfirmed, which is exactly the publish
 * most worth confirming.
 */
let lastPublishedBrand: string | null = null;

export function lastPublishedBrandId(): string | null {
  return lastPublishedBrand;
}

export function rememberPublishedBrand(brandId: string): void {
  lastPublishedBrand = brandId;
}

/** Test seam. Production never resets this; a fresh page load already has. */
export function forgetPublishedBrand(): void {
  lastPublishedBrand = null;
}
