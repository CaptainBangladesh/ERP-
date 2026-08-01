/**
 * The three tiers every module belongs to.
 *
 * A tier is a primitive here rather than a module concept because both workspaces and the
 * build-time contract check all need the same ordering, and none of them owns it. There are
 * no rules, tables, or screens attached to the value itself — the rules live in the module
 * contract that reads it.
 *
 * The order is the dependency direction: a module may depend on its own tier or lower, and
 * never on a higher one. Core is the foundation forty-plus modules will sit on, so a Core
 * module reaching up into Enterprise would make the foundation depend on the product.
 */
export const MODULE_TIERS = ['core', 'enterprise', 'custom'] as const;

export type ModuleTier = (typeof MODULE_TIERS)[number];

/** Lower rank means lower tier. Comparable with `<` and `>`. */
export function tierRank(tier: ModuleTier): number {
  return MODULE_TIERS.indexOf(tier);
}
