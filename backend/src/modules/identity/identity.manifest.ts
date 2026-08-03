import { AUTH_ROUTE, IDENTITY_MODULE } from '@erp/shared';
import type { ModuleManifest } from '../../platform/modules';
import { IdentityModule } from './identity.module';

/**
 * Identity and access, declared.
 *
 * This file is the whole of how the module joins the application. Nothing central lists it;
 * the application finds it because the directory exists, reads what it says about itself,
 * and assembles routes, migrations, permissions, navigation and the module graph from it
 * together with every other module's.
 *
 * It is also the worked example the next thirty-nine copy — see docs/modules.md.
 */
export const manifest: ModuleManifest = {
  name: IDENTITY_MODULE,

  /**
   * Core: identity is what every other module's authorization is expressed against, so
   * nothing may sit beneath it and it may depend on nothing above it.
   */
  tier: 'core',

  /**
   * Nothing. Identity is the floor of the module graph — the point below which there is
   * only the platform, which is not a module and cannot be depended on by name.
   */
  dependsOn: [],

  nestModule: IdentityModule,

  routes: [AUTH_ROUTE],

  migrations: ['20260801000000_identity_companies_users_sessions'],

  /**
   * The three tables identity owns. `Company` is the tenant root every other module's rows
   * are scoped to, and it is still identity's: the module that creates the company is the
   * module that owns the table, and everything else reaches a company through the scoping
   * the platform applies rather than by querying it.
   */
  models: ['Company', 'User', 'Session'],

  /**
   * Managing colleagues is user story 17 and arrives with roles in ticket 07. The
   * permission is declared now because the navigation entry that will be guarded by it is
   * declared now, and because declaring it is how the permission model grows without a
   * central list to edit.
   */
  permissions: ['identity:users:manage'],

  /**
   * The home screen. Ticket 07 filters these by the caller's permissions and their
   * company's tier; this one is guarded by nothing because everybody signed in has a home.
   */
  navigation: [{ label: 'Home', path: '/', order: 0 }],

  /**
   * Nothing yet, and deliberately not a placeholder.
   *
   * A declared event is a promise the assembler enforces — a module may only consume one
   * its dependency actually emits — so declaring `identity.company.created` before anything
   * emits it would let a future module bind to something that never fires. The in-process
   * emitter arrives with the first module that has a real reason to listen.
   */
  events: {
    emits: [],
    consumes: [],
  },
};
