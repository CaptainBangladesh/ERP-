import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@erp/shared';
import { ApiException } from './api-exception';

/**
 * A refusal that names the inputs at fault.
 *
 * A form can only put a message beside the right box if the response says which box, so the
 * per-field breakdown is part of the error shape rather than a nicety.
 *
 * It is separate from the code and the status because the two answer different questions.
 * "That email is already registered" is a conflict a caller branches on *and* a message
 * that belongs beside the email input; forcing it to be one or the other would mean either
 * losing the code or losing the field.
 */
export class FieldException extends ApiException {
  constructor(
    code: string,
    message: string,
    status: HttpStatus,
    readonly fields: Record<string, string>,
  ) {
    super(code, message, status);
  }
}

/**
 * The ordinary case: input that does not pass its checks.
 *
 * Ticket 04 replaces the hand-written checks in each module with a pipe that raises this
 * same exception, which is why the shape is settled here and the mechanism is not.
 */
export class ValidationException extends FieldException {
  constructor(
    fields: Record<string, string>,
    message = 'Some of the details you entered need attention.',
  ) {
    super(ERROR_CODES.validationFailed, message, HttpStatus.UNPROCESSABLE_ENTITY, fields);
  }
}
