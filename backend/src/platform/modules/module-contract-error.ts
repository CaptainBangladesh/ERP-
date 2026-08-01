/**
 * A module graph that cannot be assembled.
 *
 * These are build failures, not runtime errors — the application does not start, and the
 * check that produces them runs in CI without a database. The message is the whole
 * deliverable: at forty modules, "circular dependency detected" costs an afternoon and
 * "identity → parties → identity" costs a minute, so every message names the modules
 * involved and what would resolve it.
 */
export class ModuleContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleContractError';
  }
}
