import { HttpStatus } from '@nestjs/common';
import { LOCATION_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';

export { refuseDuplicate } from '../../http/unique-constraint';

/**
 * Everything inventory refuses, and the words it refuses in.
 *
 * Together in one file rather than at the bottom of whichever service happens to throw them,
 * as products does and for the same reasons: the module's whole vocabulary of failure is
 * readable in one sitting, which is what somebody integrating against it actually needs, and
 * the movements arriving in ticket 09 will refuse several of these same things — a location
 * this company does not have, chief among them — without a second copy of the sentence.
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
