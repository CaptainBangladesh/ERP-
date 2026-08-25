import { HttpStatus } from '@nestjs/common';
import {
  CAPTURE_SOURCE_ERROR_CODES,
  DEAL_ERROR_CODES,
  LEAD_FIELD_ERROR_CODES,
  LEAD_GROUP_ERROR_CODES,
  LEAD_IMPORT_ERROR_CODES,
  LEAD_SOURCE_ERROR_CODES,
  LEAD_STATUS_LABEL_ERROR_CODES,
  STAGE_ERROR_CODES,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { FieldException } from '../../http/validation-exception';

// ─── board organisation ─────────────────────────────────────────────────────────────

export function leadGroupNotFound(): ApiException {
  return new ApiException(
    LEAD_GROUP_ERROR_CODES.leadGroupNotFound,
    'That lead group does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/**
 * Deleting a group Leads still sit in. Says what is in the way and what to do about it, the
 * same shape `stageHasDeals` takes: a Lead pointing at a group that no longer exists is a Lead
 * that has fallen off the board without anybody being told.
 */
export function leadGroupHasLeads(count: number): ApiException {
  return new ApiException(
    LEAD_GROUP_ERROR_CODES.leadGroupHasLeads,
    `${count} lead${count === 1 ? '' : 's'} still sit${count === 1 ? 's' : ''} in this group. ` +
    `Move ${count === 1 ? 'it' : 'them'} to another group first, then delete this one.`,
    HttpStatus.CONFLICT,
  );
}

export function leadSourceNotFound(): ApiException {
  return new ApiException(
    LEAD_SOURCE_ERROR_CODES.leadSourceNotFound,
    'That lead source does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/**
 * Deleting a source Leads still name. Renaming is never refused — the id is what a Lead points
 * at, so fixing a label costs nothing; it is only *removing* the row that would leave a Lead
 * attributed to a channel that has no name.
 */
export function leadSourceHasLeads(count: number): ApiException {
  return new ApiException(
    LEAD_SOURCE_ERROR_CODES.leadSourceHasLeads,
    `${count} lead${count === 1 ? '' : 's'} still come${count === 1 ? 's' : ''} from this source. ` +
    `Rename it instead, or move ${count === 1 ? 'that lead' : 'those leads'} to another source first.`,
    HttpStatus.CONFLICT,
  );
}

// ─── custom lead fields ─────────────────────────────────────────────────────────────

export function leadFieldNotFound(): ApiException {
  return new ApiException(
    LEAD_FIELD_ERROR_CODES.leadFieldNotFound,
    'That custom field does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/**
 * A `customValues` entry that its own definition refuses — the wrong type, a `select` value
 * outside its options, or a required field left empty. One refusal carrying every complaint at
 * once, keyed by field key, so a form can mark all of its bad inputs in one round trip rather
 * than one per save.
 */
export function invalidLeadFieldValues(problems: Record<string, string>): FieldException {
  const keys = Object.keys(problems);
  return new FieldException(
    LEAD_FIELD_ERROR_CODES.invalidLeadFieldValue,
    keys.length === 1
      ? problems[keys[0]!]!
      : `${keys.length} custom fields need attention before this can be saved.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    problems,
  );
}

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

// ─── lead imports ───────────────────────────────────────────────────────────────────

export function leadImportNotFound(): ApiException {
  return new ApiException(
    LEAD_IMPORT_ERROR_CODES.importNotFound,
    'That lead import does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

export function invalidMapping(): ApiException {
  return new ApiException(
    LEAD_IMPORT_ERROR_CODES.invalidMapping,
    'The column mapping provided is invalid.',
    HttpStatus.BAD_REQUEST,
  );
}

// ─── capture sources ────────────────────────────────────────────────────────────────

export function captureSourceNotFound(): ApiException {
  return new ApiException(
    CAPTURE_SOURCE_ERROR_CODES.sourceNotFound,
    'That capture source does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

export function invalidCaptureToken(): ApiException {
  return new ApiException(
    CAPTURE_SOURCE_ERROR_CODES.invalidCaptureToken,
    'Invalid or inactive capture link.',
    HttpStatus.NOT_FOUND,
  );
}

export function rateLimitExceeded(): ApiException {
  return new ApiException(
    CAPTURE_SOURCE_ERROR_CODES.rateLimitExceeded,
    'Rate limit exceeded. Please try again later.',
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

export function unconfiguredField(key: string): ApiException {
  return new ApiException(
    CAPTURE_SOURCE_ERROR_CODES.unconfiguredField,
    `Submission named field '${key}' which is not in this source's configured field list.`,
    HttpStatus.BAD_REQUEST,
  );
}

// ─── email campaigns ─────────────────────────────────────────────────────────────────

export function campaignNotFound(): ApiException {
  return new ApiException(
    'campaign_not_found',
    'That email campaign does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

export function campaignNotDraft(): ApiException {
  return new ApiException(
    'campaign_not_draft',
    'Campaigns can only be modified while in draft status.',
    HttpStatus.BAD_REQUEST,
  );
}

export function campaignNotMaterialized(): ApiException {
  return new ApiException(
    'campaign_not_materialized',
    'Campaign recipients must be materialized before sending.',
    HttpStatus.BAD_REQUEST,
  );
}

export function campaignAlreadySent(): ApiException {
  return new ApiException(
    'campaign_already_sent',
    'This campaign has already completed sending.',
    HttpStatus.BAD_REQUEST,
  );
}

export function unsubscribeNotFound(): ApiException {
  return new ApiException(
    'unsubscribe_not_found',
    'That unsubscribe token or record does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

export function invalidOpenToken(): ApiException {
  return new ApiException(
    'invalid_open_token',
    'Invalid or expired tracking pixel token.',
    HttpStatus.NOT_FOUND,
  );
}



// ─── lead statuses ──────────────────────────────────────────────────────────────────

export function leadStatusNotFound(): ApiException {
  return new ApiException(
    LEAD_STATUS_LABEL_ERROR_CODES.leadStatusNotFound,
    'That lead status does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/**
 * Deleting one of the four built-in statuses. Says why it cannot go rather than only that it
 * cannot: the four are the lifecycle the module's own actions are written against, so removing
 * one would leave `qualify` with nowhere to put a lead.
 */
export function leadStatusNotCustom(): ApiException {
  return new ApiException(
    LEAD_STATUS_LABEL_ERROR_CODES.leadStatusNotCustom,
    'That is one of the four built-in statuses. It can be renamed and recoloured, but not removed.',
    HttpStatus.CONFLICT,
  );
}

/**
 * Deleting a status leads are still in — the same shape `leadGroupHasLeads` takes, and for the
 * same reason. The count is the number somebody needs in order to decide what to do next.
 */
export function leadStatusHasLeads(label: string, count: number): ApiException {
  return new ApiException(
    LEAD_STATUS_LABEL_ERROR_CODES.leadStatusHasLeads,
    `${count} lead${count === 1 ? ' is' : 's are'} still in "${label}". ` +
      `Move ${count === 1 ? 'it' : 'them'} to another status first, then remove this one.`,
    HttpStatus.CONFLICT,
  );
}

/**
 * Two statuses that would be stored under the same key. Named after the label rather than the
 * key, because the key is derived and the person naming the status never saw it.
 */
export function leadStatusDuplicate(label: string): FieldException {
  return new FieldException(
    LEAD_STATUS_LABEL_ERROR_CODES.leadStatusDuplicate,
    `"${label}" is too close to a status you already have.`,
    HttpStatus.CONFLICT,
    { label: 'You already have a status with this name.' },
  );
}

/**
 * Asking an ordinary edit to move a lead into `qualified` or `disqualified`. Points at the act
 * that does reach those states, because the request is not wrong about wanting to get there.
 */
export function leadStatusNotSettable(): FieldException {
  const message =
    'Qualified and Disqualified are reached by qualifying or disqualifying the lead, not by editing it.';

  return new FieldException(
    LEAD_STATUS_LABEL_ERROR_CODES.leadStatusNotSettable,
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
    { status: message },
  );
}

/**
 * A roll-up asked about more parties than a board could be showing.
 *
 * The cap is not about protecting the query — it is about what the request can mean. This
 * endpoint exists to answer for a *page* of contacts; a caller naming every party in the
 * company wants a report, and should be told so rather than quietly served one.
 */
export function tooManyRollupParties(most: number, asked: number): ApiException {
  return new ApiException(
    DEAL_ERROR_CODES.dealRollupTooManyParties,
    `Ask about at most ${most} parties at a time. This asked about ${asked}.`,
    HttpStatus.BAD_REQUEST,
  );
}
