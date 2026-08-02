import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODES, type ApiError } from '@erp/shared';
import { RestrictedFieldError, RestrictedRecordError } from '../platform/tenancy';
import { ApiException } from './api-exception';
import { FieldException } from './validation-exception';

/**
 * Every failure leaves the API as one shape: a stable `code` clients branch on, and a
 * `message` safe to show a user.
 *
 * A thrower that cares which failure it is throws `ApiException` and names its own code.
 * Anything else falls back to a code derived from the status, which is honest but coarse —
 * good enough for failures nobody branches on, such as a missing route.
 *
 * Validation adds a third element: the fields at fault, so a form can put each message
 * beside the input it belongs to. Ticket 04 replaces the hand-written checks that raise it
 * with a pipe, without changing what leaves the API.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof FieldException) {
      response.status(exception.getStatus()).json({
        code: exception.code,
        message: exception.message,
        fields: exception.fields,
      } satisfies ApiError);
      return;
    }

    if (exception instanceof ApiException) {
      response.status(exception.getStatus()).json({
        code: exception.code,
        message: exception.message,
      } satisfies ApiError);
      return;
    }

    /**
     * A caller asked for a field they may not read.
     *
     * The only tenancy refusal that reaches a client as anything but a 500, and it became one
     * the moment a list endpoint started taking field names from a query string:
     * `?sort=annualSalary` is a URL a user can type, and an unhandled failure is the wrong
     * answer to it. It is a 403 rather than a 422 because the request was not malformed —
     * the field is real and the endpoint does sort by it, for somebody holding the grant.
     *
     * The developer-facing message is still logged in full below the response, because a
     * module naming a restricted field in code that a caller never touched is a bug and the
     * 403 alone would not say so. See ADR 0004.
     */
    if (
      exception instanceof RestrictedFieldError ||
      exception instanceof RestrictedRecordError
    ) {
      this.logger.warn(exception.message);
      response.status(HttpStatus.FORBIDDEN).json({
        code: ERROR_CODES.fieldRestricted,
        message: `You do not have access to '${exception.field}'.`,
      } satisfies ApiError);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        code: codeForStatus(status),
        message: exception.message,
      } satisfies ApiError);
      return;
    }

    // Unexpected failures are logged in full and reported opaquely. Leaking a stack trace
    // to a client tells an attacker about the system and tells a user nothing useful.
    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : exception,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'internal_error',
      message: 'Something went wrong. Please try again.',
    } satisfies ApiError);
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'bad_request';
    case HttpStatus.UNAUTHORIZED:
      return 'unauthenticated';
    case HttpStatus.FORBIDDEN:
      return 'forbidden';
    case HttpStatus.NOT_FOUND:
      return 'not_found';
    case HttpStatus.CONFLICT:
      return 'conflict';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'validation_failed';
    default:
      return 'internal_error';
  }
}
