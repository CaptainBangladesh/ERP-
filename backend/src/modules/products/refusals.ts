import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PRODUCT_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { FieldException } from '../../http/validation-exception';

/**
 * Everything this module refuses, and the words it refuses in.
 *
 * Together in one file rather than at the bottom of whichever service happens to throw them,
 * because products and units refuse several of the same things — a duplicate code, a record
 * this company does not have — and two copies of a refusal are two messages that drift apart
 * while claiming to be the same rule. It also makes the module's whole vocabulary of failure
 * readable in one sitting, which is the thing a caller integrating against it actually needs.
 *
 * Every one names a stable `code` from the shared contract. Clients branch on the code and
 * never on the message; the message is for the person reading the screen.
 */

/**
 * The same 404 a record in another company gets, deliberately. Telling a caller that an
 * identifier is real but not theirs would turn the endpoint into a way of counting somebody
 * else's catalogue.
 */
export function productNotFound(): ApiException {
  return new ApiException(
    PRODUCT_ERROR_CODES.productNotFound,
    'That product does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

export function unitNotFound(): ApiException {
  return new ApiException(
    PRODUCT_ERROR_CODES.unitNotFound,
    'That unit of measure does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

export function supplierNotFound(): ApiException {
  return new ApiException(
    PRODUCT_ERROR_CODES.supplierNotFound,
    'That party does not supply this product.',
    HttpStatus.NOT_FOUND,
  );
}

/**
 * A unit that products are still measured in.
 *
 * Counted among *active* products only, which is what makes the advice in the message
 * followable: deactivating everything measured in a unit is exactly how somebody stops
 * measuring things that way, and a refusal that then still refused would be a dead end.
 */
export function unitInUse(measured: number): ApiException {
  return new ApiException(
    PRODUCT_ERROR_CODES.unitInUse,
    `${measured} active product${measured === 1 ? ' is' : 's are'} measured in this unit. ` +
      `Deactivating it would leave them measured in something the unit list says is not in ` +
      `use. Change them to another unit first, or deactivate them.`,
    HttpStatus.CONFLICT,
  );
}

export function notAParty(): FieldException {
  return new FieldException(
    PRODUCT_ERROR_CODES.notAParty,
    'That supplier is not in the address book.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    { partyId: 'Choose somebody from the address book.' },
  );
}

export function unitNotInUse(code: string): FieldException {
  return new FieldException(
    PRODUCT_ERROR_CODES.unitNotFound,
    `'${code}' is no longer in use.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    { unitId: 'Choose a unit that is still in use.' },
  );
}

export function noSuchGroup(): FieldException {
  return new FieldException(
    PRODUCT_ERROR_CODES.unitGroupNotFound,
    'That group of units does not exist.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    { groupId: 'Choose a group.' },
  );
}

/** A ratio on a unit that belongs to no group, which is a number about nothing. */
export function ratioWithoutGroup(): FieldException {
  return new FieldException(
    PRODUCT_ERROR_CODES.unitsDoNotConvert,
    'A unit that belongs to no group converts to nothing, so its ratio is 1.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    { ratio: 'A unit that belongs to no group converts to nothing, so its ratio is 1.' },
  );
}

export function unitsDoNotConvert(from: string, to: string): ApiException {
  return new ApiException(
    PRODUCT_ERROR_CODES.unitsDoNotConvert,
    `'${from}' and '${to}' do not measure the same thing, so there is no conversion between ` +
      `them. Units convert only within the group that says what they measure.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

export function productCodeTaken(code: string): string {
  return (
    `'${code}' is already the code of another product. Within a company, two products with ` +
    `one code are two names for one thing.`
  );
}

export function unitCodeTaken(code: string): string {
  return (
    `Something is already measured in '${code}'. Two units with one code would be two names ` +
    `for one measure.`
  );
}

export function groupNameTaken(name: string): string {
  return (
    `There is already a group called '${name}'. Two groups of one name would be two sets of ` +
    `units that cannot convert to each other while claiming to measure the same thing.`
  );
}

/**
 * Prisma's "that unique constraint again", as the message beside the input that caused it.
 *
 * Caught rather than checked for beforehand: the constraint is the only thing that can settle
 * a race between two people adding the same code at the same moment, and asking first would
 * just move the race earlier.
 *
 * `gone` is given only by the writes that can race with a delete — an update, where `P2025`
 * means the row vanished between the read and the write and the caller should get the 404 it
 * would have had a moment earlier. A create cannot produce one, so it does not pretend to
 * handle it.
 */
export function refuseDuplicate(
  code: string,
  field: string,
  message: string,
  gone?: () => ApiException,
) {
  return (cause: unknown): never => {
    if (cause instanceof Prisma.PrismaClientKnownRequestError) {
      if (cause.code === 'P2002') {
        throw new FieldException(code, message, HttpStatus.CONFLICT, { [field]: message });
      }
      if (cause.code === 'P2025' && gone) throw gone();
    }
    throw cause;
  };
}
