/**
 * What a request body is allowed to be.
 *
 * One mechanism, one error shape, every module. A module declares a schema beside its
 * controller and names the messages its users see; everything about collecting them,
 * refusing once, and putting each beside the right input is here.
 *
 * See `validator.ts` for the two properties that matter — every field checked before anything
 * is refused, and unknown keys ignored.
 */
export { validated } from './validation.pipe';
export {
  validator,
  Validator,
  type CrossFieldRule,
  type Parsed,
  type Schema,
  type Valid,
} from './validator';
export { optional, withDefault, accepted, refused, rule, type FieldRule, type Read } from './rule';
export {
  code,
  day,
  decimal,
  email,
  flag,
  identifier,
  money,
  oneOf,
  password,
  text,
} from './rules';
