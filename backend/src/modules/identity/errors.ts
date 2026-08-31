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

export function companyNameMismatch(): FieldException {
  return new FieldException(
    IDENTITY_ERROR_CODES.companyNameMismatch,
    'Company name does not match the company you were invited to.',
    HttpStatus.BAD_REQUEST,
    {
      companyName:
        'Company name does not match the company you were invited to. As a team member, you cannot use a different company name.',
    },
  );
}

/**
 * Somebody chose "I work for a company" and named one nothing is registered under.
 *
 * Against the company field rather than the form, because that is the input they can act
 * on, and the suggested action is the other tab: if the company really is theirs to start,
 * opening it is one click away.
 */
export function companyDoesNotExist(): FieldException {
  return new FieldException(
    IDENTITY_ERROR_CODES.companyDoesNotExist,
    "This company doesn't exist.",
    HttpStatus.BAD_REQUEST,
    {
      companyName:
        "No company is registered under that name. Check the spelling, or choose “Create a company” to open it.",
    },
  );
}

/**
 * The mirror of `companyDoesNotExist`: opening a company under a name that is taken.
 *
 * Refusing is the whole protection against a second workspace with the same name, which
 * nobody could tell apart afterwards. The message names the other tab because whoever hit
 * this is nearly always a colleague of the company's owner rather than a name clash.
 */
export function companyAlreadyExists(): FieldException {
  return new FieldException(
    IDENTITY_ERROR_CODES.companyAlreadyExists,
    'A company with that name already exists.',
    HttpStatus.CONFLICT,
    {
      companyName:
        'A company with that name already exists. If you work there, choose “I work for a company” instead.',
    },
  );
}

/**
 * Signing up without a company name — for either intent.
 *
 * The form marks the field required and the validator would catch an absent one on the
 * password path, but Google sign-up can reach the service with nothing typed at all (the
 * user clicked the button before filling the box), so the rule is enforced where both
 * paths pass rather than only at the edge one of them uses.
 */
export function companyNameRequired(): FieldException {
  return new FieldException(
    IDENTITY_ERROR_CODES.companyNameRequired,
    'Enter your company name.',
    HttpStatus.BAD_REQUEST,
    { companyName: 'Enter your company name.' },
  );
}

/**
 * Google authenticated somebody this system has never seen, on the sign-in screen.
 *
 * Not `invalidCredentials`: nothing was wrong with what they presented, and there is no
 * secret to keep — Google has already told them the account is theirs. The honest answer
 * is that they have not signed up here yet, and the screen turns it into a link to the form
 * that fixes it.
 */
export function googleAccountNotRegistered(): ApiException {
  return new ApiException(
    IDENTITY_ERROR_CODES.googleAccountNotRegistered,
    'No account here is registered to that Google address yet. Sign up to create one.',
    HttpStatus.NOT_FOUND,
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

/**
 * The mail host would not accept the company's settings, so they were not stored.
 *
 * Proved before believed, the same rule a mailbox connection follows: settings taken on trust
 * become a screen that says mail is configured and invitations that quietly never arrive.
 */
export function mailSettingsRejected(detail: string): ApiException {
  return new ApiException(
    IDENTITY_ERROR_CODES.companyMailRejected,
    `The mail server did not accept these settings: ${detail}`,
    HttpStatus.BAD_REQUEST,
  );
}

/** Configuring mail for the first time, with no password to prove it with. */
export function mailPasswordRequired(): FieldException {
  return new FieldException(
    IDENTITY_ERROR_CODES.companyMailPasswordRequired,
    'Enter the mailbox password.',
    HttpStatus.BAD_REQUEST,
    { password: 'Enter the mailbox password.' },
  );
}

/**
 * The company's mail account refused the message.
 *
 * Raised rather than swallowed, and deliberately not fallen back from: the company asked for
 * its mail to leave from its own account, and sending it through something else instead would
 * put a different sender on it without telling anybody.
 */
export function mailSendFailed(detail: string): ApiException {
  return new ApiException(
    IDENTITY_ERROR_CODES.companyMailSendFailed,
    `The invitation was created, but your mail server would not send it: ${detail}`,
    HttpStatus.BAD_GATEWAY,
  );
}
