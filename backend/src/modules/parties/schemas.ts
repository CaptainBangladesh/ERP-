import {
  PARTY_FIELDS,
  PARTY_KINDS,
  PARTY_ROLE_PATTERN,
  SETTABLE_PARTY_STATUSES,
  type PartyKind,
  type SettablePartyStatus,
} from '@erp/shared';
import type { ListSpec } from '../../platform/list';
import {
  accepted,
  email,
  flag,
  optional,
  refused,
  rule,
  text,
  validator,
  type FieldRule,
} from '../../platform/validation';

/**
 * What the address book accepts, and what it lets a caller ask of its list.
 *
 * Declared beside the module rather than in the platform, because the wording is the part
 * that belongs to whoever owns the screen: "Enter the party's name." and "Enter the
 * employee's name." are the same rule and different sentences.
 */

/** A name is a name whether it is a person's or an organisation's. */
const PARTY_NAME = {
  missing: 'Enter a name.',
  maxLength: 200,
  tooLong: 'Use 200 characters or fewer.',
} as const;

/**
 * One of a fixed set of words, refused by naming the alternatives.
 *
 * Not a `text` rule with a cross-field check afterwards: "person or organisation" is a fact
 * about the field, and putting it in the rule is what makes the message say what is allowed
 * rather than that something is wrong.
 */
function oneOf<T extends string>(
  allowed: readonly T[],
  options: { missing: string; invalid: string },
): FieldRule<T> {
  return rule(options.missing, (value) => {
    const given = typeof value === 'string' ? value.trim() : '';
    if (given.length === 0) return refused(options.missing);

    return (allowed as readonly string[]).includes(given)
      ? accepted(given as T)
      : refused(`${options.invalid} Use one of: ${allowed.join(', ')}.`);
  });
}

const KIND = oneOf<PartyKind>(PARTY_KINDS, {
  missing: 'Say whether this is a person or an organisation.',
  invalid: 'That is not a kind of party.',
});

const STATUS = oneOf<SettablePartyStatus>(SETTABLE_PARTY_STATUSES, {
  missing: 'Say whether this party is active.',
  // `merged` is real and is deliberately not offered: it is what a party becomes when it is
  // merged away, and setting it by hand would leave a record pointing at nothing.
  invalid: 'That is not a status you can set.',
});

/**
 * An identifier, checked only for shape.
 *
 * Whether the party exists, belongs to this company, and is an organisation are all
 * questions for the service, which has the database. What this stops is a malformed id
 * reaching Prisma, where an invalid UUID is a 500 rather than a message beside the input.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function identifier(options: { missing: string; invalid: string }): FieldRule<string> {
  return rule(options.missing, (value) => {
    const given = typeof value === 'string' ? value.trim() : '';
    if (given.length === 0) return refused(options.missing);
    return UUID.test(given) ? accepted(given) : refused(options.invalid);
  });
}

const ORGANISATION = {
  missing: 'Choose an organisation.',
  invalid: 'That is not an organisation.',
} as const;

const CONTACT_EMAIL = {
  missing: 'Enter an email address.',
  invalid: 'Enter an email address, such as name@example.com.',
} as const;

const PHONE = { missing: 'Enter a phone number.', maxLength: 40 } as const;

/**
 * A role, checked for shape and nothing else.
 *
 * There is no list of permitted roles anywhere and this module will never hold one. The
 * shape is enforced because a role is compared, filtered on and put in a URL — lowercase
 * kebab-case, exactly like a module name, so that `Customer` and `customer` cannot both
 * exist and mean the same thing.
 */
const ROLE = rule<string>('Enter a role.', (value) => {
  const given = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (given.length === 0) return refused('Enter a role.');
  if (given.length > 60) return refused('Use 60 characters or fewer.');

  return PARTY_ROLE_PATTERN.test(given)
    ? accepted(given)
    : refused('Use lowercase letters, numbers and hyphens, such as "employee-contact".');
});

export const CreatePartyBody = validator({
  kind: KIND,
  name: text(PARTY_NAME),
  email: optional(email(CONTACT_EMAIL)),
  phone: optional(text(PHONE)),
  organisationId: optional(identifier(ORGANISATION)),
  roles: optional(listOf(ROLE, 'Give a list of roles.')),
}).and((values, report) => {
  // Checked here and again in the service, and neither is redundant: this one produces a
  // message beside the right input, and that one is the only place that knows whether the id
  // names an organisation at all.
  if (values.kind === 'organisation' && values.organisationId) {
    report('organisationId', 'An organisation cannot belong to another organisation.');
  }
});

/**
 * A change to a party. Every field optional, at least one required.
 *
 * Absent means "do not touch it", and that includes a field sent as `null` or as an empty
 * string — the platform reads both as absent, deliberately, so that no rule in any module
 * has to have an opinion about JSON null. See `platform/validation/validator.ts`.
 *
 * The consequence worth stating: there is no way to *clear* an email, a phone number or an
 * organisation through this endpoint, only to change one. Nobody has asked to, and the way
 * to offer it when somebody does is an explicit act — a `DELETE`, or a distinct rule that
 * accepts an emptying sentinel — rather than by making an empty box mean "erase", which is
 * what an accidental keystroke also means.
 */
export const UpdatePartyBody = validator({
  name: optional(text(PARTY_NAME)),
  email: optional(email(CONTACT_EMAIL)),
  phone: optional(text(PHONE)),
  organisationId: optional(identifier(ORGANISATION)),
  status: optional(STATUS),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const AddPartyRoleBody = validator({ role: ROLE });

export const MergePartiesBody = validator({
  duplicateId: identifier({
    missing: 'Choose the duplicate to merge in.',
    invalid: 'That is not a party.',
  }),
});

export const CreatePartyAddressBody = validator({
  label: text({ missing: 'Say what this address is for.', maxLength: 60 }),
  line1: text({ missing: 'Enter the first line of the address.', maxLength: 200 }),
  line2: optional(text({ missing: 'Enter a second line, or leave it out.', maxLength: 200 })),
  city: text({ missing: 'Enter a town or city.', maxLength: 100 }),
  postcode: text({ missing: 'Enter a postcode.', maxLength: 20 }),
  country: text({ missing: 'Enter a country.', maxLength: 100 }),
  primary: optional(flag({ missing: 'Say whether this is the main address.' })),
});

/**
 * A list of values, each read by the same rule.
 *
 * Only parties needs one so far — roles given at creation — so it lives here rather than in
 * `platform/validation`. A rule earns a place there when a second module needs it, and until
 * then it belongs where its edges are somebody's actual concern.
 *
 * Duplicates are collapsed rather than refused: asking for `customer` twice is asking for
 * `customer`.
 */
function listOf<T>(inner: FieldRule<T>, missing: string): FieldRule<T[]> {
  return rule(missing, (value) => {
    if (!Array.isArray(value)) return refused(missing);

    const values: T[] = [];
    for (const entry of value) {
      const read = inner.read(entry);
      // The first bad entry decides the message, because a list of per-entry messages has
      // nowhere to be rendered: the form has one control for the whole field.
      if (!read.ok) return refused(read.message);
      if (!values.includes(read.value)) values.push(read.value);
    }

    return accepted(values);
  });
}

/**
 * What a caller may do to the party list.
 *
 * `role` is the one worth reading twice. It is not a column on `parties` — a party holds
 * several roles, each its own row — and it is filterable exactly as if it were, because
 * which table a value is stored in is not something the person operating a list screen should
 * have to know. The platform builds the `some` clause from the `via` declaration; nothing
 * here writes a join.
 *
 * Name and email are searchable together, which is what somebody typing into a search box
 * over an address book expects: half a name or half an address, whichever they remember.
 */
export const PARTY_LIST: ListSpec = {
  defaultSort: PARTY_FIELDS.name,
  fields: {
    [PARTY_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [PARTY_FIELDS.email]: { type: 'text', filterable: true, searchable: true },
    [PARTY_FIELDS.kind]: { type: 'text', sortable: true, filterable: true },
    [PARTY_FIELDS.status]: { type: 'text', sortable: true, filterable: true },
    [PARTY_FIELDS.organisationId]: { type: 'text', filterable: true },
    [PARTY_FIELDS.role]: {
      type: 'text',
      filterable: true,
      via: { relation: 'roles', field: 'role' },
    },
    [PARTY_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};
