import type { Type } from '@nestjs/common';
import type { ModuleTier, NavigationEntry } from '@erp/shared';

/**
 * What a module declares about itself.
 *
 * This is the contract the whole system assembles from. A module is added by writing one of
 * these and dropping the directory in; nothing central is edited, because with forty-plus
 * modules ahead every manual registration step would be paid forty times and every
 * omission would be a bug that only shows up in production.
 *
 * Everything here is a *declaration*, not behaviour: it can be read without starting the
 * application, which is what lets the build refuse a bad module graph before it runs.
 */
export interface ModuleManifest {
  /**
   * Lowercase kebab-case, unique across the system. Also the namespace for the module's
   * permissions and the prefix on the events it emits.
   */
  readonly name: string;

  readonly tier: ModuleTier;

  /**
   * The modules this one may reach, by name. A module may inject another's public service
   * and consume its events only if it is named here. Depending on a higher tier, on
   * something absent, or on itself through a chain all fail assembly.
   */
  readonly dependsOn: readonly string[];

  /** The Nest module composed into the application graph. Its own internals stay private. */
  readonly nestModule: Type<unknown>;

  /**
   * The API base paths this module owns, without a leading slash, matching the controller
   * prefixes inside it. Declared rather than inferred so that two modules claiming one path
   * is caught at build time instead of resolving to whichever registered first.
   */
  readonly routes: readonly string[];

  /**
   * Prisma migration directory names this module owns. Ticket 06 splits the schema file per
   * module too; until then the declaration is what establishes ownership and ordering.
   */
  readonly migrations: readonly string[];

  /** Permissions the module introduces, each `<name>:<resource>:<action>`. */
  readonly permissions: readonly string[];

  readonly navigation: readonly ModuleNavigationEntry[];

  readonly events: {
    readonly emits: readonly string[];
    readonly consumes: readonly string[];
  };
}

/**
 * A navigation entry as a module declares it. The module name is filled in by assembly, so
 * a manifest cannot attribute an entry to somebody else.
 */
export interface ModuleNavigationEntry extends Omit<NavigationEntry, 'module'> {
  /**
   * Hides the entry from users without this permission. Must be one the module declares.
   * Ticket 07 applies the filter; declaring it now means the entries do not have to be
   * revisited then.
   */
  readonly permission?: string;
}

/** A navigation entry with its owning module resolved. */
export interface AssembledNavigationEntry extends NavigationEntry {
  readonly permission?: string;
}

/** The application, derived entirely from manifests. */
export interface AssembledModules {
  /** Dependency order: every module appears after everything it depends on. */
  readonly manifests: readonly ModuleManifest[];
  /** The same order, ready to hand to Nest's `imports`. */
  readonly nestModules: readonly Type<unknown>[];
  /** Dependency order, which for migrations is also apply order. */
  readonly migrations: readonly string[];
  readonly routes: readonly string[];
  readonly permissions: readonly string[];
  readonly navigation: readonly AssembledNavigationEntry[];
  readonly events: {
    readonly emitted: readonly string[];
    readonly consumed: readonly string[];
  };
}
