import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyPatch, type GeneratedModule } from './blueprint';
import { ModuleGenerationError } from './refusals';

/**
 * The plan, on disk.
 *
 * The one part of the generator that touches a filesystem, kept apart from the plan for the
 * same reason `conformance/read.ts` is kept apart from the rules.
 *
 * Everything is decided before anything is written. Every target is checked for existence and
 * every patch is applied in memory first, so the failure modes are "nothing happened, here is
 * why" rather than "seven files and one schema edit happened, and then it stopped". Half a
 * generated module is worse than none: the person who asked for it now has to know which
 * files to delete and which central file to revert, and they have no list.
 */
const REPO_ROOT = resolve(__dirname, '../../../..');

export function writeModule(plan: GeneratedModule, root: string = REPO_ROOT): string[] {
  const clashes = plan.files.filter((file) => existsSync(resolve(root, file.path)));

  if (clashes.length > 0) {
    throw new ModuleGenerationError([
      `Generating '${plan.names.name}' would overwrite ${clashes
        .map((file) => `'${file.path}'`)
        .join(', ')}. Nothing has been written. A module is generated once, at the start; ` +
        `after that it is edited like any other code.`,
    ]);
  }

  // Patches applied in memory first: an anchor that has moved should cost nothing.
  const patched = plan.patches.map((patch) => {
    const path = resolve(root, patch.path);
    return { path, text: applyPatch(readFileSync(path, 'utf8'), patch) };
  });

  for (const file of plan.files) {
    const path = resolve(root, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.text, 'utf8');
  }

  for (const file of patched) writeFileSync(file.path, file.text, 'utf8');

  return [...plan.files.map((file) => file.path), ...plan.patches.map((patch) => patch.path)];
}
