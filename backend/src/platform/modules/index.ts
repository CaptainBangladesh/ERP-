/**
 * The module contract. Everything that assembles an application from declarations.
 *
 * Modules import from here; nothing imports from inside it.
 */
export { assembleModules } from './assemble';
export { ApplicationModule } from './application.module';
export { discoverManifests } from './discover';
export { ModuleContractError } from './module-contract-error';
export { MODULE_REGISTRY } from './registry';
export type {
  AssembledModules,
  AssembledNavigationEntry,
  ModuleManifest,
  ModuleNavigationEntry,
} from './manifest';
