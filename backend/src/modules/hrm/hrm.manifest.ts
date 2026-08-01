import { HRM_CONFIDENTIAL_GRANT, HRM_MODULE, HRM_PAY_GRANT, HRM_ROUTE } from '@erp/shared';
import type { ModuleManifest } from '../../platform/modules';
import { HrmModule } from './hrm.module';

/**
 * The shape stub, declared — and declared in exactly the same way as identity, which is the
 * claim being tested.
 *
 * Ticket 03's criterion is that the stub is registered *purely* through its manifest.
 * Nothing was added anywhere to accommodate it: no import in `app.module.ts`, no entry in a
 * registry, no branch in the assembler. It is here because the directory exists. If the
 * foundation had quietly grown inventory-shaped assumptions, this is the file that would
 * have needed an exception, and it does not.
 */
export const manifest: ModuleManifest = {
  name: HRM_MODULE,

  /**
   * Enterprise rather than core, and not only because payroll is an upsell. It means the
   * stub is the first module to prove a non-core tier assembles, and it means the stub
   * cannot be depended on by the Core modules inventory is built from — so nothing in the
   * foundation can quietly come to rely on the counter-example.
   */
  tier: 'enterprise',

  /**
   * Nothing. An employee here is hrm's own record, not a view of identity's users: not
   * everybody a company pays has a login, and a stub that needed a dependency to show its
   * shape would be showing the dependency instead.
   */
  dependsOn: [],

  nestModule: HrmModule,

  routes: [HRM_ROUTE],

  /**
   * Two, because the confidential-employee column was added after the tables were, and the
   * first migration had already been applied. Folding them would rewrite a migration the
   * databases have a checksum for, which is the one thing Prisma will not let you do quietly
   * — and the manifest takes a list precisely so that a module's schema can grow.
   */
  migrations: ['20260801091203_hrm_shape_stub', '20260801094353_hrm_confidential_employees'],

  /**
   * The last two are the ones that matter, and neither is only checked at an endpoint. The
   * platform holds them as grants in `platform/tenancy/company-owned.ts` — one on two
   * restricted columns, one on the column marking a whole employee record confidential — so
   * a caller without them gets employees with no salaries, pay runs with no amounts, and no
   * sight at all of a confidential record, wherever those rows are read from. The module
   * contract test checks that the two declarations still name the same strings.
   */
  permissions: [
    'hrm:employees:read',
    'hrm:employees:write',
    'hrm:pay-runs:read',
    'hrm:pay-runs:write',
    HRM_PAY_GRANT,
    HRM_CONFIDENTIAL_GRANT,
  ],

  /**
   * None. The stub is a shape, not a feature: it has no screens, so a menu entry would
   * point at a route the frontend does not serve. It gains one when HRM becomes a real
   * module, and the manifest is the only file that will change.
   */
  navigation: [],

  /**
   * Nothing, deliberately — a declared event is a promise the assembler enforces, and the
   * stub has nobody to make one to. `hrm.pay-run.calculated` is the obvious candidate and
   * is exactly the kind of thing an accounting module would consume; it is declared when
   * something emits it.
   */
  events: {
    emits: [],
    consumes: [],
  },
};
