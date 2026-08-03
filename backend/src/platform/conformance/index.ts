/**
 * Module boundaries, and the pack every module passes.
 *
 * A module may use another's declared public surface and nothing else. Reaching past it,
 * querying its tables, or using a module the manifest never named all fail the build — and
 * so do the quieter things: a list endpoint that invented its own parameters, a handler with
 * an unchecked body, a module writing its own company filter.
 *
 * The rules are pure functions over source text and declarations, so they run in CI on
 * nothing and can be tested against deliberately broken modules. `check.ts` is the entry
 * point the build calls; `read.ts` is the only part that touches a disk.
 *
 * See docs/modules.md for what the rules are, and ADR 0005 for why they are enforced this
 * way rather than by a linter plugin or by review.
 */
export {
  checkFrontendModules,
  checkImports,
  checkSharedPackage,
  checkTableAccess,
} from './boundaries';
export { checkModule } from './module-rules';
export { checkConformance, type ConformanceInput } from './pack';
export { conformanceInput, readSources } from './read';
export { checkModuleConformance } from './check';
export { importsIn, resolveImport, withoutComments, type SourceFile } from './source';
export { ConformanceError, describeViolation, type Violation } from './violation';
