import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assembleModules } from './assemble';
import { discoverManifests } from './discover';
import { ModuleContractError } from './module-contract-error';

/**
 * The build's opinion of the module graph.
 *
 * Run in CI before the tests, and deliberately without a database: a cycle, a missing
 * dependency, a Core module reaching up a tier, two modules claiming one route, or a
 * migration timestamped out of order are all facts about declarations, and none of them
 * should need infrastructure — or a deployment — to discover.
 *
 * The application performs the same assembly at boot, so nothing can be true here and false
 * there. This entry point exists only to run it early and print the reason legibly.
 */
export function checkModuleContract(): void {
  const manifests = discoverManifests();
  const assembled = assembleModules(manifests);

  checkMigrationsExist(assembled.migrations);

  const names = assembled.manifests.map((m) => `${m.name} (${m.tier})`);
  process.stdout.write(
    `Module contract OK — ${assembled.manifests.length} module(s) in dependency order: ` +
      `${names.join(', ') || 'none'}\n`,
  );
}

/**
 * A manifest can claim a migration that is not there. The assembler cannot tell — it never
 * touches a disk, which is what makes it testable — so the check that needs the filesystem
 * lives here, next to the only caller that has one.
 */
function checkMigrationsExist(migrations: readonly string[]): void {
  const root = resolve(__dirname, '../../../prisma/migrations');

  for (const migration of migrations) {
    if (!existsSync(resolve(root, migration))) {
      throw new ModuleContractError(
        `A manifest declares migration '${migration}', which does not exist in ` +
          `prisma/migrations. Either the directory was renamed, or the manifest was ` +
          `written before the migration was generated.`,
      );
    }
  }
}

if (require.main === module) {
  try {
    checkModuleContract();
  } catch (error) {
    if (error instanceof ModuleContractError) {
      // The message is the whole deliverable. A stack trace through the assembler would
      // bury it and point at the checker rather than at the manifest that is wrong.
      process.stderr.write(`\nModule contract violation\n\n  ${error.message}\n\n`);
      process.exit(1);
    }
    throw error;
  }
}
