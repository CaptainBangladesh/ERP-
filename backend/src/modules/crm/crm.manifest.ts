import { CRM_MODULE, CRM_ROUTE } from '@erp/shared';
import type { ModuleManifest } from '../../platform/modules';
import { CrmModule } from './crm.module';

/**
 * Crm, declared.
 *
 * Ticket 02's cut: `Lead` alone. Everything the application knows about this module before it
 * starts it. Read without running anything, which is what lets the build refuse a bad module
 * graph rather than a deployment discovering one.
 */
export const manifest: ModuleManifest = {
  name: CRM_MODULE,

  /**
   * Core — customers and pipeline are as fundamental as the address book they extend. A
   * Core module can only depend on Core, which is why `hrm` (Enterprise) and `identity`
   * (its public surface is deliberately empty) are both absent from `dependsOn` below.
   */
  tier: 'core',

  /**
   * `parties`, and nothing else. `PartyDirectory` is what lets `qualify` resolve the Party a
   * request names. The company comes from the platform's tenant scoping and the caller from
   * its session seam, so neither makes this module depend on identity.
   */
  dependsOn: ['parties'],

  nestModule: CrmModule,

  routes: [CRM_ROUTE],

  migrations: ['20260823234633_crm', '20260823235822_lead_management'],

  models: ['Lead'],

  /**
   * Read and write, in crm's own `leads` namespace — the resource this ticket ships, ahead
   * of the `deals`/`stages`/`activities`/`workflow-rules` namespaces later tickets add.
   */
  permissions: ['crm:leads:read', 'crm:leads:write'],

  navigation: [{ label: 'Leads', path: '/crm/leads', order: 50, permission: 'crm:leads:read' }],

  /**
   * Nothing yet. The spec's `crm.lead.qualified` / `crm.lead.disqualified` events are
   * candidates for a later ticket, once something actually consumes them — a declared event
   * is a promise the assembler enforces, and one nobody consumes is a promise made to nobody.
   */
  events: {
    emits: [],
    consumes: [],
  },
};
