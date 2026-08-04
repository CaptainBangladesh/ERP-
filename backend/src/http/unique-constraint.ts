import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from './api-exception';
import { FieldException } from './validation-exception';

/**
 * Prisma's "that unique constraint again", as the message beside the input that caused it.
 *
 * Caught rather than checked for beforehand, and that is the interesting part: the constraint
 * is the only thing that can settle a race between two people adding the same code at the same
 * moment, so asking first would move the race earlier rather than remove it. A `findFirst`
 * followed by a `create` is two statements with a gap in the middle, and the gap is where the
 * duplicate gets in.
 *
 * Here rather than in a module because the second module needed it — products wrote it first
 * for SKUs and unit codes, inventory needs the identical handling for location codes, and
 * movements will be the third. What stays with each module is the *code* and the *sentence*:
 * a client branches on `duplicate_product_code` or `duplicate_location_code` and never on a
 * shared one, because "that SKU exists" and "that warehouse exists" are different events that
 * a caller handles differently.
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
