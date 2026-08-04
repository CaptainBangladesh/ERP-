import { HttpStatus } from '@nestjs/common';
import { LOCATION_ERROR_CODES, MOVEMENT_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';

export { refuseDuplicate } from '../../http/unique-constraint';

/**
 * Everything inventory refuses, and the words it refuses in.
 *
 * Together in one file rather than at the bottom of whichever service happens to throw them,
 * as products does and for the same reasons: the module's whole vocabulary of failure is
 * readable in one sitting, which is what somebody integrating against it actually needs, and
 * movements refuse several of the same things locations do — somewhere this company does not
 * have, chief among them — from this one copy of the sentence. `locationNotFound` below now
 * has two callers, which is the arrangement ticket 08 predicted and left room for.
 *
 * Every one names a stable `code` from the shared contract. Clients branch on the code and
 * never on the message; the message is for the person reading the screen.
 */

/**
 * The same 404 a location in another company gets, deliberately. Telling a caller that an
 * identifier is real but not theirs would turn the endpoint into a way of counting somebody
 * else's warehouses.
 */
export function locationNotFound(): ApiException {
  return new ApiException(
    LOCATION_ERROR_CODES.locationNotFound,
    'That location does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/**
 * Deactivating somewhere that still has things in it.
 *
 * The message says what is in the way and what to do about it, because "conflict" is not
 * something a person can act on: stock left in a location nobody may move it out of would be
 * stock stranded by the very act meant to tidy the list.
 */
export function locationHoldsStock(lines: number): ApiException {
  return new ApiException(
    LOCATION_ERROR_CODES.locationHoldsStock,
    `${lines} product${lines === 1 ? '' : 's'} still held here. Deactivating this location ` +
      `would leave that stock somewhere the system says is not in use. Move it elsewhere ` +
      `first, and then deactivate.`,
    HttpStatus.CONFLICT,
  );
}

export function locationCodeTaken(code: string): string {
  return (
    `'${code}' is already the code of another location. Within a company, two locations with ` +
    `one code are two names for one place.`
  );
}

// ─── movements ──────────────────────────────────────────────────────────────────────

/**
 * The same 404 anything else in another company gets, for the same reason: an identifier that
 * is real but not yours should be indistinguishable from one that is not real at all.
 */
export function movementNotFound(): ApiException {
  return new ApiException(
    MOVEMENT_ERROR_CODES.movementNotFound,
    'That movement does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/**
 * A movement of something this company does not have in its catalogue.
 *
 * Resolved through `ProductCatalogue` rather than by reading a products table, so what this
 * actually reports is "the contract answered with nothing" — which covers a made-up identifier
 * and another company's product identically, because the contract is scoped too.
 */
export function movementProductNotFound(): ApiException {
  return new ApiException(
    MOVEMENT_ERROR_CODES.movementProductNotFound,
    'That product does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/**
 * Moving stock of something that has none to move.
 *
 * A delivery charge and an hour of consultancy are products with prices and no shelf, and the
 * catalogue says so with `stockable`. The message names the flag rather than merely refusing,
 * because the fix is in the other module's screen and somebody has to be told which one.
 */
export function productNotStockable(name: string): ApiException {
  return new ApiException(
    MOVEMENT_ERROR_CODES.productNotStockable,
    `'${name}' is not stocked, so there is no quantity of it to move. Products like a ` +
      `delivery charge or an hour of work have a price and no shelf. If this one should be ` +
      `counted, turn on “stock of this is counted” in the product itself.`,
    HttpStatus.CONFLICT,
  );
}

/**
 * Moving stock into or out of somewhere that has been deactivated.
 *
 * The mirror of `locationHoldsStock`, and what makes that refusal worth having: deactivating
 * means "we do not put things here any more", so stock arriving afterwards would make the
 * status a label rather than a rule. Refused in both directions — issuing *out* of a closed
 * location looks reasonable until you notice it is how stock gets stranded there in the first
 * place, since the way to empty somewhere is to transfer out of it while it is still open.
 */
export function locationNotInUse(name: string): ApiException {
  return new ApiException(
    MOVEMENT_ERROR_CODES.locationNotInUse,
    `'${name}' is not in use, so stock cannot be moved into or out of it. Reactivate it ` +
      `first if it is somewhere you keep things again.`,
    HttpStatus.CONFLICT,
  );
}

/**
 * Transferring stock to the same location it is already at.
 */
export function transferSameLocation(): ApiException {
  return new ApiException(
    MOVEMENT_ERROR_CODES.transferSameLocation,
    'Stock cannot be transferred to the location it is already at. Choose a different destination location.',
    HttpStatus.CONFLICT,
  );
}

