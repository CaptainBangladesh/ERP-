import { tierRank, type ModuleTier } from '@erp/shared';
import type { ModuleManifest } from '../modules';
import { MODULE_NAME, RECORD_NAME, type ModuleNames } from './module-name';

/**
 * What the generator refuses to generate, and why.
 *
 * Checked before a single file is written, which is the whole point of it being a separate
 * function: half a module on disk is worse than no module, because the person who asked for
 * it now has to know which eleven files to delete and which three central files were patched.
 *
 * The refusals are the same ones `assembleModules` makes at boot — a duplicate name, a
 * dependency that is not there, a Core module reaching up a tier — asked *earlier*. That is
 * deliberate duplication and it is worth stating why: the assembler refuses a graph that
 * cannot boot, and this refuses a graph that is about to be written down. Being told "core
 * cannot depend on enterprise" before the directory exists costs one sentence; being told
 * after costs a `git clean` and a patched `schema.prisma` somebody has to remember to revert.
 */
export interface ModuleRequest {
  readonly name: string;
  readonly tier: ModuleTier;
  /** Modules this one may reach. Each must be present, and none may be in a higher tier. */
  readonly dependsOn: readonly string[];
  /** The primary record, if English defeats the singulariser. See `module-name.ts`. */
  readonly record?: string;
  /**
   * The migration directory's timestamp, `YYYYMMDDHHMMSS`. Taken from the clock by the CLI;
   * passed explicitly by tests, so that what a test asserts does not depend on when it runs.
   */
  readonly stamp: string;
}

export function refusals(
  request: ModuleRequest,
  names: ModuleNames,
  existing: readonly ModuleManifest[],
): string[] {
  const refused: string[] = [];
  const byName = new Map(existing.map((manifest) => [manifest.name, manifest]));

  if (!MODULE_NAME.test(request.name)) {
    refused.push(
      `'${request.name}' is not a usable module name. Use lowercase kebab-case, such as ` +
        `'products' or 'field-service' — the name is the directory, the permission namespace ` +
        `and the event prefix, so it has to be predictable.`,
    );
  }

  if (byName.has(request.name)) {
    refused.push(
      `Module '${request.name}' already exists at backend/src/modules/${request.name}. A ` +
        `second module of that name would claim the same permission namespace, the same ` +
        `event prefix and — since routes are derived from the name — the same API path. If ` +
        `you meant to extend it, edit it; if you meant a different module, name it ` +
        `differently.`,
    );
  }

  if (request.record !== undefined && !RECORD_NAME.test(request.record)) {
    refused.push(
      `'${request.record}' is not a model name. Use the form schema.prisma uses — ` +
        `'Product', not 'products'.`,
    );
  }

  const owner = existing.find((manifest) => manifest.models.includes(names.record));
  if (owner) {
    refused.push(
      `Module '${owner.name}' already owns the model '${names.record}'. Every table has ` +
        `exactly one owner, which is what 'a module may not query another module's tables' ` +
        `is checked against. Pass '--record <Name>' to give '${request.name}' a record of ` +
        `its own name.`,
    );
  }

  for (const dependency of request.dependsOn) {
    const found = byName.get(dependency);

    if (!found) {
      refused.push(
        `Module '${request.name}' would depend on '${dependency}', which is not present. ` +
          `The application runs with any subset of modules, but only a subset that includes ` +
          `what it depends on — so this one could never boot.`,
      );
      continue;
    }

    if (tierRank(found.tier) > tierRank(request.tier)) {
      refused.push(
        `Module '${request.name}' is ${request.tier} tier and would depend on ` +
          `'${dependency}', which is ${found.tier} tier. A module may depend on its own tier ` +
          `or a lower one, never a higher one — otherwise the foundation ends up depending ` +
          `on the product sitting on it. Either generate '${request.name}' in the ` +
          `${found.tier} tier, or move what it needs down into a ${request.tier} module.`,
      );
    }
  }

  return refused;
}

export class ModuleGenerationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.join('\n\n'));
    this.name = 'ModuleGenerationError';
  }
}
