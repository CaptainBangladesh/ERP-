import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { assembleModules, discoverManifests } from '../modules';
import { classifiedModels, grantsByModel } from '../tenancy/company-owned';
import type { SourceFile } from './source';
import type { ConformanceInput } from './pack';

/**
 * The repository, as the pack's input.
 *
 * The one part of this area that touches a disk, kept apart from the rules for the same
 * reason `check.ts` is kept apart from `assemble.ts`: the rules are then a pure function that
 * a test can hand a deliberately broken module to, rather than something that can only be
 * exercised by breaking the repository.
 *
 * The tenancy declarations come from `company-owned.ts` directly rather than through
 * `platform/tenancy`'s entry point, because they are a fact about the source rather than
 * something a module uses — and the pack has no business being handed a Prisma client to get
 * at them.
 */
const REPO_ROOT = resolve(__dirname, '../../../..');

/** The workspaces the rules read, and the directories inside each that are source. */
const WORKSPACES = [
  { workspace: 'backend', roots: ['src'] },
  { workspace: 'packages', roots: ['src'] },
  { workspace: 'application', roots: ['src'] },
];

const SOURCE = /\.(ts|tsx)$/;

export function conformanceInput(): ConformanceInput {
  const manifests = discoverManifests();
  const assembled = assembleModules(manifests);

  return {
    modules: assembled.manifests,
    modelOwners: assembled.modelOwners,
    classifiedModels: classifiedModels(),
    grantsByModel: grantsByModel(),
    sources: readSources(),
  };
}

export function readSources(): SourceFile[] {
  return WORKSPACES.flatMap(({ workspace, roots }) =>
    roots.flatMap((root) =>
      filesIn(resolve(REPO_ROOT, workspace, root)).map((path) => ({
        path: relative(REPO_ROOT, path).split(sep).join('/'),
        text: readFileSync(path, 'utf8'),
      })),
    ),
  );
}

function filesIn(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const path = resolve(root, entry);
    if (statSync(path).isDirectory()) return filesIn(path);
    return SOURCE.test(entry) ? [path] : [];
  });
}
