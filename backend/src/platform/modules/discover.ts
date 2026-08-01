import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ModuleContractError } from './module-contract-error';
import type { ModuleManifest } from './manifest';

/**
 * Finds every module by looking, rather than by being told.
 *
 * A module is a directory under `src/modules` containing `<directory>.manifest`. Adding one
 * means creating the directory; removing one means deleting it. There is no list anywhere
 * that has to agree with the filesystem, because a list that has to agree with the
 * filesystem eventually does not.
 *
 * Resolved from this file's own location so it works identically under ts-jest, under
 * `nest start`, and from the compiled output, where the layout is the same and only the
 * extension differs.
 */
const MODULES_ROOT = resolve(__dirname, '../../modules');

export function discoverManifests(): ModuleManifest[] {
  return directoriesIn(MODULES_ROOT).map((directory) => loadManifest(MODULES_ROOT, directory));
}

function directoriesIn(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    // No modules directory at all is a legitimate state — an application with no business
    // modules still boots — so it is not an error, just nothing to assemble.
    return [];
  }

  return entries
    .filter((entry) => statSync(resolve(root, entry)).isDirectory())
    .sort();
}

function loadManifest(root: string, directory: string): ModuleManifest {
  const path = resolve(root, directory, `${directory}.manifest`);

  let loaded: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    loaded = require(path) as unknown;
  } catch (cause) {
    throw new ModuleContractError(
      `Module directory 'src/modules/${directory}' has no loadable ` +
        `'${directory}.manifest'. Every module declares one — see docs/modules.md. ` +
        `(${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }

  const manifest = (loaded as { manifest?: unknown }).manifest;

  if (!isManifest(manifest)) {
    throw new ModuleContractError(
      `'src/modules/${directory}/${directory}.manifest' does not export a 'manifest'. ` +
        `Export a const named 'manifest' typed as ModuleManifest.`,
    );
  }

  if (manifest.name !== directory) {
    // Otherwise the directory a developer reads and the name every error message prints
    // are different things, and following an error back to a file becomes a search.
    throw new ModuleContractError(
      `Module in 'src/modules/${directory}' calls itself '${manifest.name}'. A module's ` +
        `name and its directory must match.`,
    );
  }

  return manifest;
}

function isManifest(value: unknown): value is ModuleManifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ModuleManifest>;
  return typeof candidate.name === 'string' && typeof candidate.nestModule === 'function';
}
