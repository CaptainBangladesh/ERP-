/**
 * The module generator — the only supported way to add a module.
 *
 * Nothing in a module ever imports this: it is a build-time tool, like the conformance pack,
 * and its consumers are `npm run new:module` and the test that proves what it writes is
 * conformant. The area has an entry point anyway, because every platform area does, and
 * because the shape of what it offers — plan, refuse, write — is the thing worth reading
 * first.
 *
 * See docs/modules.md for what a generated module contains and what to do with it next.
 */
export { applyPatch, planModule, PatchError } from './blueprint';
export type { GeneratedFile, GeneratedModule, GeneratedPatch } from './blueprint';
export { generateModule, readRequest, stamp } from './generate';
export { namesOf, type ModuleNames } from './module-name';
export { refusals, ModuleGenerationError, type ModuleRequest } from './refusals';
export { writeModule } from './write';
