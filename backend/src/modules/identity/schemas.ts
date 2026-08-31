import {
  GOOGLE_AUTH_MODES,
  INVITATION_FIELDS,
  PASSWORD_MIN_LENGTH,
  ROLE_FIELDS,
  SIGN_UP_INTENTS,
  USER_FIELDS,
  sortParameter,
} from '@erp/shared';
import {
  accepted,
  email,
  flag,
  identifier,
  oneOf,
  optional,
  password,
  refused,
  rule,
  text,
  validator,
  type FieldRule,
} from '../../platform/validation';
import type { ListSpec } from '../../platform/list';

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

/**
 * Which of the sign-up screen's two options was chosen. Optional on the wire — the service
 * reads an absent one as `company`, the option that joins nothing — so an older client that
 * knows only about opening a company keeps working.
 */
const signUpIntent = optional(
  oneOf(SIGN_UP_INTENTS, {
    missing: 'Choose whether you are creating a company or joining one.',
    invalid: 'That is not one of the two options.',
  }),
);

export const SignUpBody = validator({
  // Required for both intents. It names the company being opened, or the one being joined —
  // see `SIGN_UP_INTENTS`.
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
  intent: signUpIntent,
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

/**
 * What comes back from the Google round trip, plus what the user had chosen before it.
 *
 * `companyName` is optional *here* and required by the service when the mode is `signup`,
 * because the same body serves both modes and sign-in has no company to name. Making it
 * required at this edge would refuse every sign-in; making it optional in the service would
 * let a Google sign-up through with no company at all.
 */
export const GoogleSignInBody = validator({
  email: email({
    missing: 'Enter your email address.',
    invalid: 'Enter a valid email address.',
  }),
  name: optional(text({ missing: 'Enter your name.' })),
  companyName: optional(text({ missing: 'Enter your company name.' })),
  mode: optional(
    oneOf(GOOGLE_AUTH_MODES, {
      missing: 'Say whether this is a sign-in or a sign-up.',
      invalid: 'That is not one of the two modes.',
    }),
  ),
  intent: signUpIntent,
});

/**
 * An email address being looked up rather than validated, same reasoning as `SignInBody`: the
 * form asks "does an account exist for this address", and refusing an odd-looking one that
 * happens to be real would defeat the point of a recovery flow.
 */
export const ForgotPasswordBody = validator({
  email: email({ missing: 'Enter your email address.' }),
});

export const ResetPasswordBody = validator({
  token: text({ missing: 'This link is missing its token.' }),
  password: password({
    missing: 'Choose a new password.',
    minLength: PASSWORD_MIN_LENGTH,
    tooShort: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  }),
});

export const AcceptInvitationBody = validator({
  companyName: text({ missing: 'Enter your company name.' }),
  name: text({ missing: 'Enter your name.' }),
  password: password({
    missing: 'Choose a password.',
    minLength: PASSWORD_MIN_LENGTH,
    tooShort: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  }),
});

/** A TCP port. The range is the whole check — the host says soon enough if it is wrong. */
function port(options: { missing: string; invalid: string }): FieldRule<number> {
  return rule(options.missing, (value) => {
    const given = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isInteger(given) || given < 1 || given > 65535) return refused(options.invalid);
    return accepted(given);
  });
}

/**
 * The company's outgoing mail settings.
 *
 * `password` is optional and that is deliberate — absent means "keep the stored one", so
 * editing the sender name does not require retyping a secret. See `CompanyMailService`.
 */
export const UpdateCompanyMailSettingsBody = validator({
  fromAddress: email({
    missing: 'Enter the address this company sends from.',
    invalid: 'Enter a valid email address.',
  }),
  fromName: optional(text({ missing: 'Enter the sender name.' })),
  host: text({ missing: 'Enter the mail server host.' }),
  port: port({ missing: 'Enter the port.', invalid: 'Enter a port between 1 and 65535.' }),
  secure: flag({ missing: 'Say whether the connection uses SSL.' }),
  username: text({ missing: 'Enter the username.' }),
  password: optional(text({ missing: 'Enter the password.' })),
});

export const InviteColleagueBody = validator({
  email: email({
    missing: 'Enter their email address.',
    invalid: 'Enter a valid email address.',
  }),
  roleId: optional(
    identifier({ missing: 'Choose a role.', invalid: 'Choose a role from the list.' }),
  ),
});

export const AssignRoleBody = validator({
  roleId: identifier({ missing: 'Choose a role.', invalid: 'Choose a role from the list.' }),
});

const ROLE_NAME = {
  missing: 'Enter a name for this role.',
  maxLength: 60,
  tooLong: 'Use 60 characters or fewer.',
} as const;

/**
 * A role's permissions, as the list of strings the frontend's checkboxes produce. Not in
 * `platform/validation/rules.ts`: nothing else in the system validates a list of anything yet,
 * and a rule earns a shared place when a second module needs it, not on the chance one might.
 */
function permissions(options: { missing: string; invalid: string }): FieldRule<string[]> {
  return rule(options.missing, (value) => {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      return refused(options.invalid);
    }
    return accepted([...new Set(value.map((item) => item.trim()).filter(Boolean))]);
  });
}

const ROLE_PERMISSIONS = {
  missing: 'Choose which permissions this role holds.',
  invalid: 'That is not a list of permissions.',
} as const;

export const CreateRoleBody = validator({
  name: text(ROLE_NAME),
  permissions: permissions(ROLE_PERMISSIONS),
});

/** A change. Every field optional, at least one required — absent means "do not touch it". */
export const UpdateRoleBody = validator({
  name: optional(text(ROLE_NAME)),
  permissions: optional(permissions(ROLE_PERMISSIONS)),
}).and((values, report) => {
  const changed = values.name !== undefined || values.permissions !== undefined;
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const ROLE_LIST: ListSpec = {
  defaultSort: ROLE_FIELDS.name,
  fields: {
    [ROLE_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [ROLE_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};

export const USER_LIST: ListSpec = {
  defaultSort: USER_FIELDS.name,
  fields: {
    [USER_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [USER_FIELDS.email]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [USER_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};

/** Newest invitation first, because whoever is inviting people is nearly always looking at
 * the one they just sent. */
export const INVITATION_LIST: ListSpec = {
  defaultSort: sortParameter(INVITATION_FIELDS.createdAt, true),
  fields: {
    [INVITATION_FIELDS.email]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [INVITATION_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};
