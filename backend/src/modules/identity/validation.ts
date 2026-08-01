import { PASSWORD_MIN_LENGTH, type SignInRequest, type SignUpRequest } from '@erp/shared';
import { ValidationException } from '../../http/validation-exception';

/**
 * What sign-up and sign-in accept.
 *
 * Hand-written, and only until ticket 04 introduces the validation pipe every module will
 * share. It is here rather than deferred because the acceptance criterion is a form showing
 * messages against the offending inputs, and a form built against a response that does not
 * name fields would have to be rebuilt when one did. The shape it produces is the one the
 * pipe will produce, so only this file goes when the pipe arrives.
 *
 * Every field is checked before anything is refused, so a user fixing a form is told
 * everything that is wrong with it at once rather than one problem per attempt.
 */

// Deliberately permissive. An address either delivers or it does not, and a stricter
// pattern's only reliable achievement is rejecting somebody's real, valid address.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ValidSignUp {
  companyName: string;
  name: string;
  email: string;
  password: string;
}

export function validateSignUp(body: Partial<SignUpRequest> | undefined): ValidSignUp {
  const input = body ?? {};
  const fields: Record<string, string> = {};

  const companyName = text(input.companyName);
  if (!companyName) fields.companyName = 'Enter your company name.';

  const name = text(input.name);
  if (!name) fields.name = 'Enter your name.';

  const email = normaliseEmail(input.email);
  if (!email) fields.email = 'Enter your email address.';
  else if (!EMAIL.test(email)) fields.email = 'Enter a valid email address.';

  const password = typeof input.password === 'string' ? input.password : '';
  if (!password) fields.password = 'Choose a password.';
  else if (password.length < PASSWORD_MIN_LENGTH) {
    fields.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }

  if (Object.keys(fields).length > 0) throw new ValidationException(fields);

  return { companyName, name, email, password };
}

export function validateSignIn(body: Partial<SignInRequest> | undefined): SignInRequest {
  const input = body ?? {};
  const fields: Record<string, string> = {};

  const email = normaliseEmail(input.email);
  if (!email) fields.email = 'Enter your email address.';

  const password = typeof input.password === 'string' ? input.password : '';
  // No length rule on sign-in: the stored password was valid when it was chosen, and
  // enforcing today's rule here would lock out an account rather than prompt a change.
  if (!password) fields.password = 'Enter your password.';

  if (Object.keys(fields).length > 0) throw new ValidationException(fields);

  return { email, password };
}

/**
 * The one way an address is written down.
 *
 * Applied on the way in for both sign-up and sign-in, so "Ada@Northwind.test" and
 * "ada@northwind.test" are the same account. Doing it in one place is what makes the unique
 * constraint on the column mean what it appears to mean.
 */
export function normaliseEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
