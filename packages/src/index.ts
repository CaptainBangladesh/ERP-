/**
 * @erp/shared — primitives with no business meaning.
 *
 * The rule: anything with rules, tables, or screens is a module. This package holds only
 * types and constants that every module agrees on. Domain concepts (parties, products,
 * stock) belong to Core modules, never here — a shared package that accumulates domain
 * concepts becomes a second application that everything depends on and nobody owns.
 *
 * Relative imports carry explicit `.js` extensions so the same source emits both a
 * CommonJS build (for the Nest backend) and an ESM build (for the Vite frontend).
 */

export * from './http/error.js';
export * from './skeleton/probe.js';
