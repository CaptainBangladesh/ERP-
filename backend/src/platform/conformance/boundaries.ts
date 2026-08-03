import type { ModuleManifest } from '../modules';
import {
  importsIn,
  moduleOf,
  occurrences,
  resolveImport,
  type SourceFile,
} from './source';
import type { Violation } from './violation';

/**
 * The wall between modules.
 *
 * Three rules, and they are the same rule seen from three sides: a module may use another's
 * declared public surface and nothing else. Reaching past it, querying its tables, or
 * reaching for a module the manifest never named are all ways of building a system whose
 * real dependency graph is not the one anybody wrote down — and a graph nobody wrote down is
 * one nobody can delete a module from.
 *
 * They are written now rather than at module forty because rules written against real
 * modules are better rules, and because the first module every other one will consume —
 * parties — arrives with them. The cost was a short cleanup pass over the two modules that
 * predate them, which is the cheapest that pass will ever be.
 */

export const BACKEND_MODULES = 'backend/src/modules/';
export const BACKEND_PLATFORM = 'backend/src/platform/';
export const BACKEND_SUPPORT = ['backend/src/http/', 'backend/src/prisma/'];
export const SHARED_SOURCE = 'packages/src/';
export const FRONTEND_MODULES = 'application/src/modules/';

/** The areas of the shared package. Anything else there is a domain concept in hiding. */
const SHARED_AREAS = ['http', 'numeric', 'session', 'modules', 'ui'];

/** Files allowed at the top of `packages/src`, and directly under `packages/src/modules`. */
const SHARED_ROOT_FILES = ['index.ts'];
const SHARED_MODULE_FILES = ['tier.ts', 'navigation.ts'];

/**
 * Who may import whom.
 *
 * Four refusals, each with a permitted alternative in its message, because the point of the
 * check is to end the sentence "you cannot do that" with "do this instead".
 */
export function checkImports(
  sources: readonly SourceFile[],
  modules: readonly ModuleManifest[],
): Violation[] {
  const violations: Violation[] = [];
  const declared = new Map(modules.map((m) => [m.name, new Set(m.dependsOn)]));

  for (const source of sources) {
    const owner = moduleOf(source.path, BACKEND_MODULES);
    const isPlatform =
      source.path.startsWith(BACKEND_PLATFORM) ||
      BACKEND_SUPPORT.some((root) => source.path.startsWith(root));

    for (const { specifier, line } of importsIn(source)) {
      /**
       * The shared package's components are a second entry point so that the Nest backend
       * can import the wire contracts without acquiring React. Importing them here would
       * quietly undo that — the backend would start bundling a DOM it has no use for, and
       * the separation would survive only as a comment.
       */
      if (specifier === '@erp/shared/ui' && source.path.startsWith('backend/')) {
        violations.push({
          rule: 'backend-imports-ui',
          module: owner,
          path: source.path,
          line,
          message:
            `'@erp/shared/ui' is the frontend's entry point on the shared package and the ` +
            `backend must never import it — the two entry points exist so that Nest does ` +
            `not acquire React. Import the wire contract from '@erp/shared' instead.`,
        });
        continue;
      }

      const target = resolveImport(source.path, specifier);
      if (!target) continue;

      const reached = moduleOf(target, BACKEND_MODULES);

      if (isPlatform && reached) {
        violations.push({
          rule: 'platform-imports-module',
          path: source.path,
          line,
          message:
            `The platform imports module '${reached}'. It is the other way round: the ` +
            `platform declares a seam — as 'platform/auth' declares 'SessionAuthority' — ` +
            `and the module binds an implementation to it. A platform that named a module ` +
            `would be a platform that could not boot without it.`,
        });
        continue;
      }

      if (!owner || !reached || reached === owner) {
        if (owner) violations.push(...platformEntryPoint(source, target, line, owner));
        continue;
      }

      const surface = `${BACKEND_MODULES}${reached}`;

      if (target !== surface && target !== `${surface}/index`) {
        violations.push({
          rule: 'cross-module-internals',
          module: owner,
          path: source.path,
          line,
          message:
            `Module '${owner}' imports '${target}', which is inside module '${reached}'. ` +
            `Only '${reached}''s public surface is reachable from outside it: import from ` +
            `'${relativeTo(source.path, surface)}', which is '${surface}/index.ts'. If what ` +
            `you need is not exported there, that is a conversation with '${reached}' ` +
            `about its contract rather than a deeper import.`,
        });
        continue;
      }

      if (!declared.get(owner)?.has(reached)) {
        violations.push({
          rule: 'undeclared-dependency',
          module: owner,
          path: source.path,
          line,
          message:
            `Module '${owner}' imports module '${reached}' without declaring it. Add ` +
            `'${reached}' to 'dependsOn' in ${owner}.manifest.ts — the module graph is what ` +
            `the build orders migrations by and what the deletion test is checked against, ` +
            `so an undeclared edge makes both of them describe something other than the ` +
            `code. If the dependency is not one '${owner}' should have, listen for one of ` +
            `'${reached}''s events instead.`,
        });
      }
    }
  }

  return violations;
}

/**
 * The platform has entry points too.
 *
 * `platform/tenancy` and `platform/list` are areas with an `index.ts` that says what a module
 * may use and what is internal to how the area works — which is the whole reason ADR 0003's
 * deferred row-level security can be layered underneath tenancy without a module changing. A
 * module reaching past one would bind to the mechanism rather than to the seam.
 *
 * `src/http` and `src/prisma` are flat: no barrel, no internals to reach past, so nothing to
 * refuse. When either grows one, this list is where it moves.
 */
function platformEntryPoint(
  source: SourceFile,
  target: string,
  line: number,
  owner: string,
): Violation[] {
  if (!target.startsWith(BACKEND_PLATFORM)) return [];

  const inside = target.slice(BACKEND_PLATFORM.length).split('/');
  if (inside.length <= 1 || inside[1] === 'index') return [];

  const area = inside[0];
  const entry = `${BACKEND_PLATFORM}${area}`;

  return [
    {
      rule: 'platform-internals',
      module: owner,
      path: source.path,
      line,
      message:
        `Module '${owner}' imports '${target}', which is inside the platform's '${area}' ` +
        `area. Import '${relativeTo(source.path, entry)}' instead — '${entry}/index.ts' is ` +
        `what the area offers modules, and everything behind it is free to change without ` +
        `forty modules changing with it.`,
    },
  ];
}

/**
 * A module may not query another module's tables.
 *
 * The rule that makes the module graph a fact about the data as well as about the imports.
 * An import can be refused and worked around by reading the other module's rows directly,
 * which is worse than the import: it binds to a schema rather than to a contract, and it
 * survives every refactor of the module that owns it right up until it does not.
 *
 * Recognised by the delegate name, which is the model name with a lowercase first letter —
 * `prisma.payRunLine` is `PayRunLine`. A variable deliberately named to defeat that would
 * defeat it; an ordinary mistake would not, and this refuses ordinary mistakes at build time
 * rather than leaving them to review.
 */
export function checkTableAccess(
  sources: readonly SourceFile[],
  modelOwners: Readonly<Record<string, string>>,
): Violation[] {
  const owners = new Map(
    Object.entries(modelOwners).map(([model, module]) => [delegateOf(model), { model, module }]),
  );

  const violations: Violation[] = [];

  for (const source of sources) {
    const owner = moduleOf(source.path, BACKEND_MODULES);
    if (!owner) continue;

    for (const { match, line } of occurrences(source, DELEGATE)) {
      const found = owners.get(match[1] ?? '');
      if (!found || found.module === owner) continue;

      violations.push({
        rule: 'cross-module-tables',
        module: owner,
        path: source.path,
        line,
        message:
          `Module '${owner}' queries '${found.model}', which module '${found.module}' owns. ` +
          `Ask '${found.module}' for what you need through its public surface ` +
          `('${BACKEND_MODULES}${found.module}/index.ts'), or listen for one of its events. ` +
          `Reading another module's table binds '${owner}' to a schema instead of to a ` +
          `contract, and nothing tells '${found.module}' that it has become one.`,
      });
    }
  }

  return violations;
}

const DELEGATE = /\b(?:prisma|tx|client|db)\.([a-z][A-Za-z0-9]*)\b/g;

function delegateOf(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * The shared package holds primitives, and stays that way.
 *
 * The failure mode it is guarding against is slow and never looks like a mistake at the
 * time: one module needs a type another module also needs, the obvious home is the package
 * both already depend on, and forty repetitions later the shared package is a second
 * application that everything depends on and nobody owns.
 *
 * Two structural rules, because "no domain concepts" cannot be read off a file and the shape
 * of the package can:
 *
 * - the only areas are the primitive ones, plus `modules/<name>/contract.ts` for a module's
 *   wire shapes — so `packages/src/parties/` is refused before anybody argues about it;
 * - nothing outside a contract may import a contract, so the primitives cannot come to
 *   depend on a module's vocabulary while claiming to have none.
 */
export function checkSharedPackage(sources: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];

  for (const source of sources) {
    if (!source.path.startsWith(SHARED_SOURCE)) continue;

    const inside = source.path.slice(SHARED_SOURCE.length).split('/');
    const area = inside[0] ?? '';

    if (inside.length === 1) {
      if (!SHARED_ROOT_FILES.includes(area)) {
        violations.push(strayFromShared(source.path, area));
      }
    } else if (!SHARED_AREAS.includes(area)) {
      violations.push(strayFromShared(source.path, area));
    } else if (area === 'modules') {
      violations.push(...checkContract(source.path, inside.slice(1)));
    }

    // The package's own barrel is the one file whose job is to name every contract.
    if (source.path === `${SHARED_SOURCE}index.ts`) continue;

    const withinContract = inside[0] === 'modules' && inside.length > 2;

    for (const { specifier, line } of importsIn(source)) {
      const target = resolveImport(source.path, specifier);
      if (!target || withinContract) continue;

      // Any contract, whether or not its module is still present: a primitive reaching for
      // one has taken on domain meaning either way.
      const reached = moduleOf(target, `${SHARED_SOURCE}modules/`);
      if (!reached || SHARED_MODULE_FILES.includes(`${reached}.ts`)) continue;

      violations.push({
        rule: 'shared-primitive-imports-contract',
        path: source.path,
        line,
        message:
          `'${source.path}' imports '${reached}''s wire contract. A primitive that knows ` +
          `what a '${reached}' is has stopped being a primitive: the dependency runs from ` +
          `contracts to primitives and never back. Move the shape into the contract, or ` +
          `take the meaning out of it and leave the primitive.`,
      });
    }
  }

  return violations;
}

function strayFromShared(path: string, area: string): Violation {
  return {
    rule: 'shared-package-area',
    path,
    message:
      `'${path}' is outside every area '@erp/shared' has. The package holds primitives with ` +
      `no business meaning (${SHARED_AREAS.join(', ')}) and each module's wire contract at ` +
      `'modules/<name>/contract.ts', and nothing else — anything with rules, tables or ` +
      `screens is a module. If '${area}' is a domain concept, it belongs to the module that ` +
      `owns it; if it is genuinely a primitive, it belongs in one of the areas above.`,
  };
}

function checkContract(path: string, inside: readonly string[]): Violation[] {
  const [named, ...rest] = inside;
  const first = named ?? '';

  if (rest.length === 0) {
    return SHARED_MODULE_FILES.includes(first)
      ? []
      : [
          {
            rule: 'shared-package-contract',
            path,
            message:
              `'${path}' sits among the module contracts without being one. Only ` +
              `${SHARED_MODULE_FILES.map((f) => `'${f}'`).join(' and ')} live directly ` +
              `here; everything else is 'modules/<name>/contract.ts'.`,
          },
        ];
  }

  /**
   * A contract for a module that is not present is *not* a violation, and that is the
   * subset rule reaching into this check.
   *
   * Deleting a business module has to leave the application building — that is the spec's
   * deletion test, and this check runs ahead of the build in CI. Refusing a contract whose
   * module is gone would make `rm -r backend/src/modules/parties` a failed build for a
   * reason that has nothing to do with parties, so a stale contract is tolerated: it is
   * types nobody imports, which the compiler will get to before anybody trips over it.
   *
   * What is refused is the shape, which is what actually keeps domain concepts out.
   */
  if (rest.join('/') !== 'contract.ts') {
    return [
      {
        rule: 'shared-package-contract',
        path,
        message:
          `'${path}' is not '${first}''s contract. A module's shared footprint is exactly ` +
          `'modules/${first}/contract.ts' — request and response shapes and the constants ` +
          `both workspaces must agree on. Behaviour belongs in the module.`,
      },
    ];
  }

  return [];
}

/**
 * The frontend's modules do not know about each other at all.
 *
 * Stricter than the backend on purpose. A frontend manifest declares which component renders
 * which path and nothing else — no dependencies, because there is nothing a screen needs from
 * another module's screens that it should not get from the API and the shared contract.
 * Importing another module's component would put a build-time edge between two things a user
 * experiences as separate pages, and would take a deleted module's screens down with it.
 */
export function checkFrontendModules(sources: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];

  for (const source of sources) {
    const owner = moduleOf(source.path, FRONTEND_MODULES);
    if (!owner) continue;

    for (const { specifier, line } of importsIn(source)) {
      const target = resolveImport(source.path, specifier);
      const reached = target && moduleOf(target, FRONTEND_MODULES);
      if (!reached || reached === owner) continue;

      violations.push({
        rule: 'frontend-cross-module',
        module: owner,
        path: source.path,
        line,
        message:
          `Module '${owner}''s screens import module '${reached}''s. Frontend modules are ` +
          `independent: what they share comes from '@erp/shared/ui' if it is a component ` +
          `with no business meaning, or from '${reached}''s API and wire contract if it is ` +
          `data. Otherwise deleting '${reached}' would take '${owner}''s screens with it.`,
      });
    }
  }

  return violations;
}

/** A target path as the specifier a source would write for it. */
function relativeTo(fromPath: string, target: string): string {
  const from = fromPath.split('/').slice(0, -1);
  const to = target.split('/');

  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;

  const up = from.length - shared;
  const climb = up === 0 ? ['.'] : Array.from({ length: up }, () => '..');
  return [...climb, ...to.slice(shared)].join('/');
}
