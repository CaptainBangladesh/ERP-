import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * An error that names its own machine-readable code.
 *
 * The code is the seam that matters. A code derived from the HTTP status alone makes every
 * conflict in the system indistinguishable — a client cannot tell "that SKU already exists"
 * from "that product still has movement history", because both are `409 conflict`. With
 * forty-plus modules ahead, retrofitting per-error codes later would mean touching every
 * throw site and every client branch, so the seam exists from the first module.
 *
 * Throw this rather than Nest's built-in exceptions wherever a caller might reasonably
 * branch on which failure occurred.
 */
export class ApiException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(message, status);
  }
}
