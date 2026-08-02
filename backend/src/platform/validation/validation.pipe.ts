import type { PipeTransform } from '@nestjs/common';
import type { Parsed, Schema, Validator } from './validator';

/**
 * A validator, as the thing Nest puts between a request body and a handler.
 *
 * Declared on the parameter — `@Body(validated(CreateEmployee))` — rather than registered
 * globally, because a global pipe has to be told what to validate against by decorating the
 * DTO class, and this codebase has no DTO classes: request shapes are interfaces in the
 * shared contract, which both workspaces bind to and which do not survive to runtime.
 *
 * The consequence is worth stating plainly: a handler that forgets the pipe gets an unchecked
 * body. That is the same bargain as `@Public()` — visible at the point it is made, and
 * checked by the conformance pack ticket 05 introduces.
 */
export function validated<S extends Schema>(validator: Validator<S>): PipeTransform {
  return {
    transform(value: unknown): Parsed<S> {
      return validator.parse(value);
    },
  };
}
