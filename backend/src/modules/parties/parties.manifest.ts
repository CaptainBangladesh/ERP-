import { PARTIES_MODULE, PARTIES_ROUTE } from '@erp/shared';
import type { ModuleManifest } from '../../platform/modules';
import { PartiesModule } from './parties.module';

/**
 * The address book, declared.
 *
 * The first module every other one will consume, which is why the boundary rules landed with
 * it rather than after it: rules written against a module that four later modules are about
 * to depend on are rules that have been argued with.
 */
export const manifest: ModuleManifest = {
  name: PARTIES_MODULE,

  /**
   * Core. A customer is not an upsell — Sales, Purchase, Inventory, HRM and Marketing all
   * need to name the same person, and a module in a tier above them could not be depended
   * on by the ones below.
   */
  tier: 'core',

  /**
   * Nothing, and that is worth a sentence because it looks wrong.
   *
   * A party belongs to a company and is created by a user, so it seems to depend on identity.
   * It does not: the company is applied by the platform's tenant scoping and never named
   * here, and who the caller is arrives through the platform's session seam. Both of those
   * are the platform's, and the platform is not a module. Declaring identity would be
   * claiming an edge the code does not have — and the deletion test would then refuse a
   * subset that in fact assembles.
   */
  dependsOn: [],

  nestModule: PartiesModule,

  routes: [PARTIES_ROUTE],

  migrations: ['20260803015345_parties'],

  models: ['Party', 'PartyRole', 'PartyAddress'],

  /**
   * Read and write, and nothing finer. Merging and deactivating are writes to the address
   * book rather than powers of their own: somebody trusted to correct a customer's name is
   * trusted to say that two records are the same customer. Ticket 07 can split them if a
   * real role turns out to need the distinction, and inventing it now would be inventing it
   * from imagination.
   */
  permissions: ['parties:parties:read', 'parties:parties:write'],

  navigation: [
    { label: 'Parties', path: '/parties', order: 10, permission: 'parties:parties:read' },
  ],

  /**
   * Nothing yet, deliberately. `parties.party.merged` is the obvious candidate — a module
   * holding a reference to the duplicate would want to know — but `PartyDirectory.party`
   * already follows a merge, so nothing is broken by not hearing about it. A declared event
   * is a promise the assembler enforces, and one nobody consumes is a promise made to
   * nobody. It is declared when something listens.
   */
  events: {
    emits: [],
    consumes: [],
  },
};
