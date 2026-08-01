import { tierRank } from '@erp/shared';
import { ModuleContractError } from './module-contract-error';
import type {
  AssembledModules,
  AssembledNavigationEntry,
  ModuleManifest,
} from './manifest';

const MODULE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PERMISSION = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

/**
 * Turns a set of manifests into an application, or refuses to.
 *
 * Pure, and deliberately so: it takes declarations and returns declarations, touching no
 * database, no filesystem, and no Nest container. That is what lets the same function serve
 * two callers — the running application at boot, and the build check that runs in CI with
 * no infrastructure at all — so a graph that would fail to start cannot merge.
 *
 * The subset rule: any dependency-closed subset assembles. Dropping inventory works;
 * dropping products while inventory remains does not, and says so.
 */
export function assembleModules(manifests: readonly ModuleManifest[]): AssembledModules {
  const byName = indexByName(manifests);

  for (const manifest of byName.values()) {
    checkDependenciesExist(manifest, byName);
    checkTier(manifest, byName);
    checkPermissions(manifest);
    checkNavigation(manifest);
  }

  const ordered = orderByDependency(byName);

  checkRoutesAreUnique(ordered);
  checkEventsAreDeclared(ordered, byName);

  const migrations = orderMigrations(ordered, byName);

  return {
    manifests: ordered,
    nestModules: ordered.map((m) => m.nestModule),
    migrations,
    routes: ordered.flatMap((m) => [...m.routes]),
    permissions: ordered.flatMap((m) => [...m.permissions]).sort(),
    navigation: assembleNavigation(ordered),
    events: {
      emitted: unique(ordered.flatMap((m) => [...m.events.emits])).sort(),
      consumed: unique(ordered.flatMap((m) => [...m.events.consumes])).sort(),
    },
  };
}

function indexByName(manifests: readonly ModuleManifest[]): Map<string, ModuleManifest> {
  const byName = new Map<string, ModuleManifest>();

  for (const manifest of manifests) {
    if (!MODULE_NAME.test(manifest.name)) {
      throw new ModuleContractError(
        `'${manifest.name}' is not a usable module name. Use lowercase kebab-case, such ` +
          `as 'identity' or 'field-service'; the name is also the module's permission ` +
          `namespace and event prefix, so it has to be predictable.`,
      );
    }
    if (byName.has(manifest.name)) {
      throw new ModuleContractError(
        `Module '${manifest.name}' is declared twice. Every module directory under ` +
          `src/modules must declare a distinct name.`,
      );
    }
    byName.set(manifest.name, manifest);
  }

  return byName;
}

function checkDependenciesExist(
  manifest: ModuleManifest,
  byName: Map<string, ModuleManifest>,
): void {
  for (const dependency of manifest.dependsOn) {
    if (dependency === manifest.name) {
      throw new ModuleContractError(`Module '${manifest.name}' depends on itself.`);
    }
    if (!byName.has(dependency)) {
      throw new ModuleContractError(
        `Module '${manifest.name}' depends on '${dependency}', which is not present. ` +
          `Either add it back, or remove '${manifest.name}' too — the application runs ` +
          `with any subset of modules, but only a subset that includes what it depends on.`,
      );
    }
  }
}

function checkTier(manifest: ModuleManifest, byName: Map<string, ModuleManifest>): void {
  for (const name of manifest.dependsOn) {
    const dependency = byName.get(name);
    if (!dependency) continue;

    if (tierRank(dependency.tier) > tierRank(manifest.tier)) {
      throw new ModuleContractError(
        `Module '${manifest.name}' is ${manifest.tier} tier and depends on '${name}', ` +
          `which is ${dependency.tier} tier. A module may depend on its own tier or a ` +
          `lower one, never a higher one — otherwise the foundation ends up depending on ` +
          `the product sitting on it. Either move the shared behaviour down into a ` +
          `${manifest.tier} module, or have '${name}' depend on '${manifest.name}' instead.`,
      );
    }
  }
}

function checkPermissions(manifest: ModuleManifest): void {
  for (const permission of manifest.permissions) {
    if (!PERMISSION.test(permission)) {
      throw new ModuleContractError(
        `Module '${manifest.name}' declares '${permission}', which is not a permission. ` +
          `Permissions have the form module:resource:action, such as ` +
          `'${manifest.name}:users:read'.`,
      );
    }
    if (!permission.startsWith(`${manifest.name}:`)) {
      throw new ModuleContractError(
        `Module '${manifest.name}' declares permission '${permission}', which is in ` +
          `another module's namespace. A module may only introduce permissions prefixed ` +
          `with its own name — that is what lets permissions be added without a central ` +
          `list and without two modules colliding.`,
      );
    }
  }
}

function checkNavigation(manifest: ModuleManifest): void {
  for (const entry of manifest.navigation) {
    if (entry.permission && !manifest.permissions.includes(entry.permission)) {
      throw new ModuleContractError(
        `Module '${manifest.name}' guards its '${entry.label}' navigation entry with ` +
          `'${entry.permission}', which it does not declare. Add the permission to the ` +
          `manifest, or the entry would be invisible to everyone.`,
      );
    }
  }
}

function checkRoutesAreUnique(ordered: readonly ModuleManifest[]): void {
  const owner = new Map<string, string>();

  for (const manifest of ordered) {
    for (const route of manifest.routes) {
      const existing = owner.get(route);
      if (existing) {
        throw new ModuleContractError(
          `Route '${route}' is claimed by both '${existing}' and '${manifest.name}'. ` +
            `One module owns a path; whichever registered first would silently win.`,
        );
      }
      owner.set(route, manifest.name);
    }
  }
}

function checkEventsAreDeclared(
  ordered: readonly ModuleManifest[],
  byName: Map<string, ModuleManifest>,
): void {
  for (const manifest of ordered) {
    for (const event of manifest.events.consumes) {
      const emitters = manifest.dependsOn.filter((name) =>
        byName.get(name)?.events.emits.includes(event),
      );

      if (emitters.length === 0) {
        throw new ModuleContractError(
          `Module '${manifest.name}' consumes event '${event}', which no module it ` +
            `depends on emits. Listening to an event without declaring the dependency is ` +
            `how the module graph starts describing something other than the code.`,
        );
      }
    }
  }
}

/**
 * Kahn's algorithm, with ties broken on tier and then on name.
 *
 * That there *is* a tie-break is the first point. Manifests arrive in filesystem order,
 * which differs between a developer's machine and CI, and an ordering that varied with it
 * would make assembly — and therefore a deployment — non-reproducible.
 *
 * That it is tier before name is the second. Two modules with no dependency between them
 * have no ordering the graph can insist on, so something arbitrary decides — and a purely
 * alphabetical tie-break would put an Enterprise module ahead of a Core one for no better
 * reason than the letter it starts with. Tier is the direction everything else in this
 * contract runs in, so the arbitrary choice may as well agree with it.
 */
function orderByDependency(byName: Map<string, ModuleManifest>): ModuleManifest[] {
  const remaining = new Map(
    [...byName.values()].map((m) => [m.name, new Set(m.dependsOn)] as const),
  );
  const ordered: ModuleManifest[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([name]) => name)
      .sort(byTierThenName(byName));

    if (ready.length === 0) throw cycleError(remaining, byName);

    for (const name of ready) {
      const manifest = byName.get(name);
      if (manifest) ordered.push(manifest);
      remaining.delete(name);
    }

    for (const dependencies of remaining.values()) {
      for (const name of ready) dependencies.delete(name);
    }
  }

  return ordered;
}

function byTierThenName(
  byName: Map<string, ModuleManifest>,
): (a: string, b: string) => number {
  const rank = (name: string): number => {
    const tier = byName.get(name)?.tier;
    return tier ? tierRank(tier) : 0;
  };

  return (a, b) => rank(a) - rank(b) || a.localeCompare(b);
}

/** Walks the unresolved remainder to find one concrete cycle worth printing. */
function cycleError(
  remaining: Map<string, Set<string>>,
  byName: Map<string, ModuleManifest>,
): ModuleContractError {
  const path: string[] = [];
  const onPath = new Set<string>();

  const walk = (name: string): string[] | undefined => {
    if (onPath.has(name)) return [...path.slice(path.indexOf(name)), name];
    if (!remaining.has(name)) return undefined;

    path.push(name);
    onPath.add(name);
    for (const dependency of byName.get(name)?.dependsOn ?? []) {
      const found = walk(dependency);
      if (found) return found;
    }
    path.pop();
    onPath.delete(name);
    return undefined;
  };

  const start = [...remaining.keys()].sort()[0];
  const cycle = start ? walk(start) : undefined;

  return new ModuleContractError(
    `Modules depend on each other in a cycle: ${(cycle ?? [...remaining.keys()].sort()).join(
      ' → ',
    )}. Break it by moving the shared behaviour into a lower-tier module both can depend ` +
      `on, or by replacing one direction of the dependency with an event.`,
  );
}

/**
 * Every migration, in the order Prisma will apply them, having checked that that order
 * respects the module graph.
 *
 * Prisma applies migrations in directory-name order, which is timestamp order, and knows
 * nothing about modules. Two things follow, and they are easy to conflate.
 *
 * The *check* is that dependency order and timestamp order agree: a module whose migration
 * sorts ahead of its dependency's would reference a table that does not exist yet, and
 * catching it here turns a failed deploy into a failed build.
 *
 * The *list* is name order, not module order. Modules that depend on nothing have no
 * ordering between them — `hrm` and `identity` are both roots of the graph — so emitting
 * them grouped by module would describe an apply order Prisma has no intention of using.
 * Anything reading this list wants what will actually happen.
 */
function orderMigrations(
  ordered: readonly ModuleManifest[],
  byName: Map<string, ModuleManifest>,
): string[] {
  const owner = new Map<string, string>();

  for (const manifest of ordered) {
    for (const migration of manifest.migrations) {
      const existing = owner.get(migration);
      if (existing) {
        throw new ModuleContractError(
          `Migration '${migration}' is claimed by both '${existing}' and ` +
            `'${manifest.name}'. Each migration belongs to exactly one module.`,
        );
      }
      owner.set(migration, manifest.name);
    }
  }

  for (const manifest of ordered) {
    const earliest = [...manifest.migrations].sort()[0];
    if (!earliest) continue;

    for (const name of transitiveDependencies(manifest, byName)) {
      const latest = [...(byName.get(name)?.migrations ?? [])].sort().at(-1);
      if (latest && latest > earliest) {
        throw new ModuleContractError(
          `Migration '${earliest}' of module '${manifest.name}' sorts before ` +
            `'${latest}' of '${name}', which '${manifest.name}' depends on. Prisma ` +
            `applies migrations in name order, so this one would run against a schema ` +
            `its dependency has not created yet. Regenerate it so its timestamp is later.`,
        );
      }
    }
  }

  return ordered.flatMap((m) => [...m.migrations]).sort();
}

function transitiveDependencies(
  manifest: ModuleManifest,
  byName: Map<string, ModuleManifest>,
): Set<string> {
  const found = new Set<string>();
  const queue = [...manifest.dependsOn];

  while (queue.length > 0) {
    const name = queue.pop();
    if (!name || found.has(name)) continue;
    found.add(name);
    queue.push(...(byName.get(name)?.dependsOn ?? []));
  }

  return found;
}

function assembleNavigation(
  ordered: readonly ModuleManifest[],
): AssembledNavigationEntry[] {
  return ordered
    .flatMap((manifest) =>
      manifest.navigation.map((entry) => ({ ...entry, module: manifest.name })),
    )
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
