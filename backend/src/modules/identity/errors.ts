import { HttpStatus } from '@nestjs/common';
import { IDENTITY_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { FieldException } from '../../http/validation-exception';

/**
 * Every refusal this module raises, in one file. Small enough on its own module by module —
 * `hrm.service.ts` keeps its at the bottom — but identity now has several services sharing the
 * same handful of failures, so one place is what keeps two of them from drifting into two
 * slightly different messages for one situation.
 */

/**
 * Carries a field as well as a code. The code is what a client branches on; the field is
 * what puts the message beside the email input rather than at the top of the form.
 *
 * Sign-up and inviting a colleague are the two places admitting an address is taken is right:
 * whoever is submitting it is trying to create that account, telling them nothing leaves them
 * stuck, and a form that lets you discover the answer by trying cannot keep the secret anyway.
 */
export function emailAlreadyRegistered(): FieldException {
  return new FieldException(
    IDENTITY_ERROR_CODES.emailAlreadyRegistered,
    'That email address is already registered.',
    HttpStatus.CONFLICT,
    { email: 'That email address is already registered. Sign in instead.' },
  );
}

export function invalidCredentials(): ApiException {
  return new ApiException(
    IDENTITY_ERROR_CODES.invalidCredentials,
    'That email address and password do not match an account.',
    HttpStatus.UNAUTHORIZED,
  );
}

/**
 * One message for an invitation that is unknown, expired, or already accepted. Telling them
 * apart would not help anyone act differently — ask whoever invited you for another — and
 * there is no secret in a token's status the way there is in whether an email has an account.
 */
export function invitationInvalid(): ApiException {
  return new ApiException(
    IDENTITY_ERROR_CODES.invitationInvalid,
    'This invitation link is invalid or has expired. Ask whoever invited you to send another.',
    HttpStatus.GONE,
  );
}

/** Same reasoning as `invitationInvalid`, for a reset link. */
export function resetTokenInvalid(): ApiException {
  return new ApiException(
    IDENTITY_ERROR_CODES.resetTokenInvalid,
    'This password reset link is invalid or has expired. Request a new one.',
    HttpStatus.GONE,
  );
}

export function roleNotFound(): ApiException {
  return new ApiException(
    IDENTITY_ERROR_CODES.roleNotFound,
    'That role does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/** A role still assigned to somebody. Reassign them before deleting it. */
export function roleInUse(): ApiException {
  return new ApiException(
    IDENTITY_ERROR_CODES.roleInUse,
    'That role is assigned to somebody and cannot be deleted. Reassign them first.',
    HttpStatus.CONFLICT,
  );
}

export function userNotFound(): ApiException {
  return new ApiException(
    IDENTITY_ERROR_CODES.userNotFound,
    'That person does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
