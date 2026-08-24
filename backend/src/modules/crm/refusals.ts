import { HttpStatus } from '@nestjs/common';
import { DEAL_ERROR_CODES, STAGE_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';

/**
 * Everything Stage and Deal refuse, together in one file rather than at the bottom of whichever
 * service happens to throw them — matching inventory's `refusals.ts`, and for the same reason:
 * this module's vocabulary of failure for its newer resources is readable in one sitting.
 *
 * `Lead`'s own refusals stay where ticket 02 put them, at the bottom of `leads.service.ts` —
 * this file is additive rather than a wholesale move, the same restraint ticket 08 showed when
 * it introduced `movements`' refusals beside `locations`' rather than touching what already
 * worked.
 *
 * Every one names a stable `code` from the shared contract. Clients branch on the code and
 * never on the message; the message is for the person reading the screen.
 */

// ─── stages ─────────────────────────────────────────────────────────────────────────

/**
 * The same 404 a stage in another company gets, deliberately. Telling a caller that an
 * identifier is real but not theirs would turn the endpoint into a way of counting somebody
 * else's pipeline.
 */
export function stageNotFound(): ApiException {
  return new ApiException(
    STAGE_ERROR_CODES.stageNotFound,
    'That stage does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/**
 * A second `'won'` or a second `'lost'` Stage in one company — a cross-row invariant Postgres
 * cannot express as a simple constraint, so this is `StagesService` catching it instead.
 */
export function duplicateStageOutcome(outcome: 'won' | 'lost'): ApiException {
  return new ApiException(
    STAGE_ERROR_CODES.duplicateStageOutcome,
    `Another stage already means '${outcome}'. Only one stage per company may mean ${outcome} ` +
      `— change that one first if this is the one that should.`,
    HttpStatus.CONFLICT,
  );
}

/**
 * Deleting a Stage that Deals still sit in. The message says what is in the way and what to do
 * about it, because "conflict" alone gives nobody something to act on: a Deal left pointing at
 * a Stage that no longer exists is a Deal that has fallen out of the pipeline silently.
 */
export function stageHasDeals(count: number): ApiException {
  return new ApiException(
    STAGE_ERROR_CODES.stageHasDeals,
    `${count} deal${count === 1 ? '' : 's'} still sit${count === 1 ? 's' : ''} in this stage. ` +
      `Move ${count === 1 ? 'it' : 'them'} to another stage first, then delete this one.`,
    HttpStatus.CONFLICT,
  );
}

// ─── deals ──────────────────────────────────────────────────────────────────────────

/**
 * The same 404 anything else in another company gets, for the same reason: an identifier that
 * is real but not yours should be indistinguishable from one that is not real at all.
 */
export function dealNotFound(): ApiException {
  return new ApiException(
    DEAL_ERROR_CODES.dealNotFound,
    'That deal does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/**
 * A `stageId` that does not resolve within this company — a made-up id, or another company's
 * Stage, indistinguishable on purpose.
 */
export function dealStageNotFound(): ApiException {
  return new ApiException(
    DEAL_ERROR_CODES.dealStageNotFound,
    'That stage does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/**
 * A `partyId` that does not resolve through `PartyDirectory` — a made-up id, or another
 * company's Party.
 */
export function dealPartyNotFound(): ApiException {
  return new ApiException(
    DEAL_ERROR_CODES.dealPartyNotFound,
    'That party does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
