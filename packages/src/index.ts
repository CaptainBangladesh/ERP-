/**
 * @erp/shared — primitives with no business meaning.
 *
 * The rule: anything with rules, tables, or screens is a module. This package holds only
 * types and constants that every module agrees on. Domain concepts (parties, products,
 * stock) belong to Core modules, never here — a shared package that accumulates domain
 * concepts becomes a second application that everything depends on and nobody owns.
 *
 * The one concession is `modules/<name>/contract.ts`: a module's paths, its request and
 * response types, its own error codes, and any constant both sides must agree on. Both
 * workspaces bind to it so an API change breaks the build rather than the user's screen.
 * Wire shapes only — the behaviour behind them stays in the module.
 *
 * Relative imports carry explicit `.js` extensions so the same source emits both a
 * CommonJS build (for the Nest backend) and an ESM build (for the Vite frontend).
 */

export * from './http/error.js';
export * from './http/list.js';
export * from './numeric/decimal.js';
export * from './numeric/money.js';
export * from './numeric/quantity.js';
export * from './session/principal.js';
export * from './modules/tier.js';
export * from './modules/navigation.js';
export * from './modules/identity/contract.js';
export * from './modules/hrm/contract.js';
export * from './modules/parties/contract.js';
export * from './modules/products/contract.js';
