import { AUTH_ROUTE, IDENTITY_MODULE, IDENTITY_ROUTE } from '@erp/shared';
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

  /**
   * Two bases. `AUTH_ROUTE` is everything reachable with no session, or that establishes
   * one — sign-up, sign-in, session, sign-out, and now account recovery and invitation
   * acceptance. `IDENTITY_ROUTE` is everything that requires being signed in already:
   * colleagues, their roles, and role definitions.
   */
  routes: [AUTH_ROUTE, IDENTITY_ROUTE],

  migrations: [
    '20260801000000_identity_companies_users_sessions',
    '20260803114923_identity_roles_and_recovery',
    '20260830140000_identity_company_mail_settings',
  ],

  /**
   * `Company`, `User` and `Session` were here from the start. The other five arrived with
   * roles and recovery: `Role` and `RolePermission` are what a role *is*; `UserRole` is who
   * holds one; `Invitation` and `PasswordReset` are the two single-use tokens account
   * recovery and colleague invitation share the same shape for.
   */
  models: ['Company', 'User', 'Session', 'Role', 'RolePermission', 'UserRole', 'Invitation', 'PasswordReset'],

  /**
   * Read and write, for colleagues and for roles separately: somebody trusted to invite a
   * colleague and assign them a role is not automatically trusted to redefine what that role
   * grants.
   */
  permissions: [
    'identity:users:read',
    'identity:users:write',
    'identity:roles:read',
    'identity:roles:write',
    // Company-wide settings — today, how the company's own mail is sent. Separate from
    // managing colleagues: somebody trusted to invite people is not automatically trusted
    // to change where every invitation and password reset comes from.
    'identity:company:read',
    'identity:company:write',
  ],

  /**
   * The home screen is guarded by nothing, because everybody signed in has one. Team and
   * Roles are guarded by the read permission for each — the write actions on those screens
   * are gated the same way their endpoints are, by the same permission strings.
   */
  navigation: [
    { label: 'Home', path: '/', order: 0 },
    { label: 'Team', path: '/team', order: 90, permission: 'identity:users:read' },
    { label: 'Roles', path: '/roles', order: 91, permission: 'identity:roles:read' },
    {
      label: 'Company mail',
      path: '/company-mail',
      order: 92,
      permission: 'identity:company:read',
    },
  ],

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
