import { ValidationException } from '../../http/validation-exception';
import type { FieldRule } from './rule';

/**
 * What a request body is allowed to be, and what a caller is told when it is not.
 *
 * One mechanism for every module, producing exactly the error shape ticket 02 and 03 wrote
 * by hand: a `validation_failed` code, a message for the form, and a map from field name to
 * the message that belongs beside that input. Nothing that consumes the API changed when
 * this replaced the hand-written checks, which was the point of settling the shape first.
 *
 * Two properties are load-bearing and easy to lose:
 *
 * - **Every field is checked before anything is refused.** A user fixing a form is told
 *   everything that is wrong at once rather than one problem per attempt.
 * - **Unknown keys are ignored — not kept.** A key outside the schema is dropped, never
 *   merged back into what `parse` returns. Refusing it outright would make every additive
 *   API change a breaking one for a client that echoes a field back unchanged; keeping it
 *   instead would let anything ride past whatever the schema declares, on every one of this
 *   platform's endpoints, since this one class backs all of them. `passthroughValidator`
 *   below is the named, visible exception for the rare endpoint that means to take a shape
 *   the caller defines — everything else must go through a schema field to be kept.
 */

export type Schema = Readonly<Record<string, FieldRule<unknown>>>;

/** The values a schema produces, with each field's type carried through from its rule. */
export type Parsed<S extends Schema> = {
  [K in keyof S]: S[K] extends FieldRule<infer T> ? T : never;
};

/** The parsed type of a validator, for typing the controller parameter it fills. */
export type Valid<V> = V extends Validator<infer S> ? Parsed<S> : never;

/**
 * A rule spanning more than one field — "the period ends before it starts", "a change that
 * changes nothing".
 *
 * Run only once every field has parsed, because a cross-field rule reading a field that
 * failed its own check would be reasoning about a value that does not exist. It reports
 * against whichever field a user should look at, which is a judgement the rule makes and the
 * mechanism cannot.
 */
export type CrossFieldRule<S extends Schema> = (
  values: Parsed<S>,
  report: (field: Extract<keyof S, string>, message: string) => void,
) => void;

export class Validator<S extends Schema> {
  constructor(
    private readonly schema: S,
    private readonly crossFieldRules: readonly CrossFieldRule<S>[] = [],
    private readonly passthroughUnknown: boolean = false,
  ) {}

  /** The same validator with one more cross-field rule. Chainable, and never mutating. */
  and(crossFieldRule: CrossFieldRule<S>): Validator<S> {
    return new Validator(
      this.schema,
      [...this.crossFieldRules, crossFieldRule],
      this.passthroughUnknown,
    );
  }

  parse(input: unknown): Parsed<S> {
    const body = isRecord(input) ? input : {};
    const fields: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    for (const [name, rule] of Object.entries(this.schema)) {
      // `null` is treated as absent rather than as a value. A client clearing a box sends one
      // as readily as it omits the key, and telling those two apart would mean every optional
      // field in every module having an opinion about JSON null.
      const raw = body[name];
      if (raw === undefined || raw === null) {
        if (rule.required) fields[name] = rule.missing;
        else values[name] = rule.absent;
        continue;
      }

      const read = rule.read(raw);
      if (read.ok) values[name] = read.value;
      else fields[name] = read.message;
    }

    if (Object.keys(fields).length === 0) {
      for (const crossFieldRule of this.crossFieldRules) {
        crossFieldRule(values as Parsed<S>, (field, message) => {
          fields[field] = message;
        });
      }
    }

    if (Object.keys(fields).length > 0) throw new ValidationException(fields);

    if (!this.passthroughUnknown) return values as Parsed<S>;

    const extra: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(body)) {
      if (!(key in this.schema)) extra[key] = val;
    }

    return { ...extra, ...values } as Parsed<S>;
  }
}

export function validator<S extends Schema>(schema: S): Validator<S> {
  return new Validator(schema);
}

/**
 * A validator that keeps whatever it does not recognize instead of dropping it — for the
 * rare endpoint whose entire job is accepting a shape the *caller* defines: a public capture
 * form or webhook mapping onto one company's own custom fields. The schema still declares and
 * checks whatever built-in fields exist; everything outside it passes through unexamined by
 * this mechanism and must be checked by something else downstream (the handler's own logic),
 * or it is exactly the "public door that is more lenient than the form beside it" bug this
 * platform's validators otherwise rule out by construction. Reach for `validator()` first —
 * this is the named exception, not a second default.
 */
export function passthroughValidator<S extends Schema>(schema: S): Validator<S> {
  return new Validator(schema, [], true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
