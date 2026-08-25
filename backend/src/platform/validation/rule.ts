/**
 * One field's rule: what it accepts, and what it says when it does not.
 *
 * A rule reads an unknown value and answers with either a value of a known type or the
 * message that belongs beside that input. It never throws and never refuses on its own,
 * because refusing on the first bad field would tell a user one problem per attempt — the
 * validator collects every message and refuses once.
 *
 * The messages live at the point of use rather than inside the rule, because "Enter your
 * company name." and "Enter the employee's name." are the same rule and different sentences,
 * and a rule library that owned the wording would produce forty forms that all say
 * "Required".
 */
export interface FieldRule<T> {
  /** Whether the field has to be present at all. */
  readonly required: boolean;
  /** What is said when a required field is absent. */
  readonly missing: string;
  /** The value an absent optional field takes. `undefined`, unless a default was given. */
  readonly absent: T;
  read(value: unknown): Read<T>;
}

export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export function accepted<T>(value: T): Read<T> {
  return { ok: true, value };
}

export function refused<T>(message: string): Read<T> {
  return { ok: false, message };
}

/**
 * Builds a required rule from the two halves that vary: the message for absence, and how a
 * present value is read.
 */
export function rule<T>(missing: string, read: (value: unknown) => Read<T>): FieldRule<T> {
  return { required: true, missing, absent: undefined as T, read };
}

/**
 * The same field, allowed to be absent.
 *
 * Absent becomes `undefined` — distinct from present-and-empty, which is still a refusal.
 * That distinction is the whole of the difference between creating a record and changing
 * one: `PATCH` may omit a name, but it may not send a blank one.
 */
export function optional<T>(inner: FieldRule<T>): FieldRule<T | undefined> {
  return { ...inner, required: false, absent: undefined };
}

/**
 * The same field, allowed to be absent *or* explicitly emptied.
 *
 * `optional` gives a field two answers — absent, or a value — and refuses a blank. That is
 * right for anything that must always hold something once it is set. A nullable column needs
 * a third answer: "there is no longer a value here". Somebody clearing a wrong phone number
 * out of a cell has to be able to say so, and under `optional` they cannot: a blank string is
 * refused and a `null` is read as absent, so the old number stays.
 *
 * Here a blank parses to `null`, which `defined()` writes to the column. Everything else still
 * goes through the inner rule, so an emptied field is the only new thing accepted — a
 * malformed email is refused exactly as before.
 *
 * Only for columns that are genuinely nullable. A lead's name is `optional` on update and
 * must stay that way; a lead with no name is not a lead.
 */
export function clearable<T>(inner: FieldRule<T>): FieldRule<T | null | undefined> {
  return {
    ...inner,
    required: false,
    absent: undefined,
    read: (value) =>
      typeof value === 'string' && value.trim().length === 0 ? accepted(null) : inner.read(value),
  };
}

/** The same field, taking a stated value when absent. */
export function withDefault<T>(inner: FieldRule<T>, absent: T): FieldRule<T> {
  return { ...inner, required: false, absent };
}
