import { PASSWORD_MIN_LENGTH } from '@erp/shared';
import { email, password, text, validator } from '../../platform/validation';

/**
 * What sign-up and sign-in accept.
 *
 * Ticket 02 wrote these checks by hand, against the error shape ticket 04 would later
 * produce with a pipe. This is that replacement: the messages are unchanged and so is what
 * leaves the API, because the shape was settled before the mechanism was built.
 *
 * Every field is checked before anything is refused — a property of the validator rather
 * than of this file — so a user fixing a form is told everything that is wrong at once.
 */

export const SignUpBody = validator({
  companyName: text({ missing: 'Enter your company name.' }),
  name: text({ missing: 'Enter your name.' }),
  email: email({
    missing: 'Enter your email address.',
    invalid: 'Enter a valid email address.',
  }),
  password: password({
    missing: 'Choose a password.',
    minLength: PASSWORD_MIN_LENGTH,
    tooShort: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  }),
});

export const SignInBody = validator({
  // No format rule and no length rule, and both absences are deliberate. The address is
  // being looked up rather than accepted, and the stored password was valid when it was
  // chosen — enforcing today's minimum here would lock out an account rather than prompt a
  // change to it.
  email: email({ missing: 'Enter your email address.' }),
  password: password({
    missing: 'Enter your password.',
    minLength: 1,
    tooShort: 'Enter your password.',
  }),
});
