import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError } from '@erp/shared';
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
