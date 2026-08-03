import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
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
  checkEveryModelIsOwned(assembled.modelOwners);

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

/**
 * Every table belongs to a module, and no manifest claims one that is not there.
 *
 * The same bargain `platform/tenancy/company-owned.ts` strikes with scoping, for the same
 * reason: a table nobody owns is a table the boundary check has no opinion about, and a
 * rule with a silent gap in it is worse than no rule, because people stop reading for the
 * gap. It lives here rather than in the assembler because it needs the datamodel — which
 * ships with the generated client and needs no database, so this still runs in CI on nothing.
 *
 * A module claiming a model that does not exist is caught with it. Otherwise a renamed model
 * would leave an ownership claim behind, and the next module to introduce that name would
 * find it already taken by somebody who no longer has it.
 */
function checkEveryModelIsOwned(owners: Readonly<Record<string, string>>): void {
  const actual = new Set(Prisma.dmmf.datamodel.models.map((model) => model.name));

  const unowned = [...actual].filter((model) => !(model in owners)).sort();
  if (unowned.length > 0) {
    throw new ModuleContractError(
      `${unowned.map(quote).join(', ')} ${unowned.length === 1 ? 'is' : 'are'} in ` +
        `schema.prisma but claimed by no module. Add ${
          unowned.length === 1 ? 'it' : 'them'
        } to the owning module's manifest under 'models' — a table nobody owns is a table ` +
        `the boundary check cannot refuse a cross-module query against.`,
    );
  }

  const absent = Object.entries(owners)
    .filter(([model]) => !actual.has(model))
    .sort(([a], [b]) => a.localeCompare(b));

  const first = absent[0];
  if (first) {
    const [model, module] = first;
    throw new ModuleContractError(
      `Module '${module}' claims model '${model}', which is not in schema.prisma. Either ` +
        `the model was renamed and the manifest was not, or the claim outlived the table.`,
    );
  }
}

function quote(value: string): string {
  return `'${value}'`;
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
