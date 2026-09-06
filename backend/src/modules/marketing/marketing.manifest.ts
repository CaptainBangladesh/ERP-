import { MARKETING_MODULE, MARKETING_ROUTE } from '@erp/shared';
import type { ModuleManifest } from '../../platform/modules';
import { MarketingModule } from './marketing.module';

/**
 * Marketing, declared.
 *
 * Everything the application knows about this module before it starts it. Read without
 * running anything, which is what lets the build refuse a bad module graph rather than a
 * deployment discovering one.
 */
export const manifest: ModuleManifest = {
  name: MARKETING_MODULE,

  tier: 'core',

  /**
   * The modules this one may reach, and the only ones it may import. Note what does *not*
   * belong here: the company comes from the platform's tenant scoping and the caller from
   * its session seam, so neither makes this module depend on identity.
   */
  dependsOn: ['crm', 'parties'],

  nestModule: MarketingModule,

  routes: [MARKETING_ROUTE],

  migrations: ['20260906121344_marketing'],

  models: ['Marketing'],

  permissions: ['marketing:marketing:read', 'marketing:marketing:write'],

  navigation: [
    {
      label: 'Marketing',
      path: '/marketing',
      order: 50,
      permission: 'marketing:marketing:read',
    },
  ],

  /**
   * Nothing yet, and that is the right default. A declared event is a promise the assembler
   * enforces; one nobody consumes is a promise made to nobody. Declare it when something
   * listens.
   */
  events: {
    emits: [],
    consumes: [],
  },
};
