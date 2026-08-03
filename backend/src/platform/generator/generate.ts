import { MODULE_TIERS, type ModuleTier } from '@erp/shared';
import { assembleModules, discoverManifests } from '../modules';
import { planModule } from './blueprint';
import { namesOf } from './module-name';
import { ModuleGenerationError, refusals, type ModuleRequest } from './refusals';
import { writeModule } from './write';

/**
 * `npm run new:module -- --name products --tier core --depends-on parties`
 *
 * The only supported way to add a module, and that is a claim about consistency rather than
 * about ceremony. Forty-plus modules are ahead; each one written by hand is a fresh
 * opportunity to page a list slightly differently, to name an error code in a new shape, or
 * to forget the tenancy classification — and none of those fails loudly on the day it is
 * written. Consistency at that scale cannot come from discipline. It comes from the starting
 * point being correct.
 *
 * What it produces is a *working* module, not a skeleton: a table, a list under the
 * platform's conventions, a screen with its empty state, and tests. It passes
 * `check:modules`, `check:conformance` and both suites the moment it exists, so the first
 * thing anybody does with it is change working code.
 *
 * It refuses before it writes — see `refusals.ts` — and it does the three edits that cannot
 * be derived from a directory: the Prisma schema, the tenancy classification, and the shared
 * barrel.
 */
export function generateModule(request: ModuleRequest): string[] {
  const existing = discoverManifests();
  const names = namesOf(request.name, request.record);

  const problems = refusals(request, names, existing);
  if (problems.length > 0) throw new ModuleGenerationError(problems);

  const plan = planModule(request);

  // The same assembly the application performs at boot, asked before the module exists. A
  // graph that cannot boot should be refused while refusing costs nothing.
  assembleModules([...existing, { ...plan.declaration, nestModule: class Generated {} }]);

  return writeModule(plan);
}

/**
 * Arguments, read strictly.
 *
 * Every unknown flag is an error rather than something ignored: a mistyped `--depend-on`
 * silently generating a module with no dependencies is exactly the kind of quiet wrongness
 * the generator exists to remove.
 */
export function readRequest(argv: readonly string[]): ModuleRequest {
  const given = new Map<string, string>();

  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at] ?? '';
    if (!flag.startsWith('--')) throw new ModuleGenerationError([`Unexpected argument '${flag}'. ${USAGE}`]);

    const value = argv[at + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new ModuleGenerationError([`'${flag}' needs a value. ${USAGE}`]);
    }

    given.set(flag.slice(2), value);
    at += 1;
  }

  const unknown = [...given.keys()].filter((flag) => !FLAGS.includes(flag));
  if (unknown.length > 0) {
    throw new ModuleGenerationError([
      `Unknown ${unknown.length === 1 ? 'flag' : 'flags'} ${unknown
        .map((flag) => `'--${flag}'`)
        .join(', ')}. ${USAGE}`,
    ]);
  }

  const name = given.get('name');
  if (!name) throw new ModuleGenerationError([`A module needs a name. ${USAGE}`]);

  const tier = given.get('tier') ?? 'core';
  if (!(MODULE_TIERS as readonly string[]).includes(tier)) {
    throw new ModuleGenerationError([
      `'${tier}' is not a tier. Use one of: ${MODULE_TIERS.join(', ')}. A module may depend on its ` +
        `own tier or a lower one, never a higher one.`,
    ]);
  }

  return {
    name,
    tier: tier as ModuleTier,
    dependsOn: (given.get('depends-on') ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
    record: given.get('record'),
    stamp: stamp(new Date()),
  };
}

const FLAGS = ['name', 'tier', 'depends-on', 'record'];

const USAGE =
  `Usage: npm run new:module -- --name <name> [--tier core|enterprise|custom] ` +
  `[--depends-on a,b] [--record <Model>]`;

/** `YYYYMMDDHHMMSS`, which is the order Prisma applies migrations in. */
export function stamp(now: Date): string {
  return now.toISOString().replace(/\D/g, '').slice(0, 14);
}

if (require.main === module) {
  try {
    const request = readRequest(process.argv.slice(2));
    const written = generateModule(request);

    process.stdout.write(`\nModule '${request.name}' generated\n\n`);
    for (const path of written) process.stdout.write(`  ${path}\n`);
    process.stdout.write(
      `\n  Next: 'npm run db:migrate' to apply the migration, then make it yours. The ` +
        `module already passes 'check:modules', 'check:conformance' and both suites — run ` +
        `them now, so that anything that breaks later is something you did.\n\n`,
    );
  } catch (error) {
    if (error instanceof ModuleGenerationError) {
      process.stderr.write(`\nCannot generate that module\n\n`);
      for (const problem of error.problems) process.stderr.write(`  ${problem}\n\n`);
      process.exit(1);
    }
    throw error;
  }
}
