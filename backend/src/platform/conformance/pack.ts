import type { ModuleManifest } from '../modules';
import {
  checkFrontendModules,
  checkImports,
  checkSharedPackage,
  checkTableAccess,
  SHARED_SOURCE,
} from './boundaries';
import { checkModule, sourcesOf } from './module-rules';
import type { SourceFile } from './source';
import type { Violation } from './violation';

/**
 * The conformance pack: everything the build has an opinion about that a type checker cannot
 * see.
 *
 * Pure, in the same way and for the same reason `assembleModules` is pure. It takes source
 * text and declarations and answers with a list; it opens no files and boots nothing. That is
 * what lets one function serve both callers — `check.ts`, which runs it in CI over the real
 * tree, and `test/conformance.spec.ts`, which runs it over deliberately violating sources to
 * prove each rule actually refuses. A check that could only be exercised by breaking the repo
 * is a check nobody exercises.
 *
 * Adding a module means passing this. That is the whole intent: at forty modules, "somebody
 * will notice in review" is not a mechanism, and the thing reviewers stop noticing first is
 * the convention they have read thirty-nine times already.
 */
export interface ConformanceInput {
  readonly modules: readonly ModuleManifest[];
  /** Every source in the repo the rules apply to, repo-relative with forward slashes. */
  readonly sources: readonly SourceFile[];
  /** Which model each module owns, from the assembled manifests. */
  readonly modelOwners: Readonly<Record<string, string>>;
  /** The models classified in `platform/tenancy/company-owned.ts`. */
  readonly classifiedModels: readonly string[];
  /** The grants restricting each model's fields or rows, from the same file. */
  readonly grantsByModel: Readonly<Record<string, readonly string[]>>;
}

export function checkConformance(input: ConformanceInput): Violation[] {
  const classifiedModels = new Set(input.classifiedModels);

  const perModule = input.modules.flatMap((manifest) =>
    checkModule({
      manifest,
      sources: sourcesOf(manifest.name, input.sources),
      contract: input.sources.find(
        (source) => source.path === `${SHARED_SOURCE}modules/${manifest.name}/contract.ts`,
      ),
      classifiedModels,
      grantsByModel: input.grantsByModel,
    }),
  );

  return [
    ...checkImports(input.sources, input.modules),
    ...checkTableAccess(input.sources, input.modelOwners),
    ...checkSharedPackage(input.sources),
    ...checkFrontendModules(input.sources),
    ...perModule,
  ].sort(byPathThenLine);
}

function byPathThenLine(a: Violation, b: Violation): number {
  return a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0);
}
