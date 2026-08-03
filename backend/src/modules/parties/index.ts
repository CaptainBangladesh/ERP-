/**
 * The address book's public surface.
 *
 * One abstract class, and it is the only thing about parties another module may name. Sales,
 * Purchase, Inventory and Marketing all read parties through this; none of them knows that a
 * party is three tables, that a role is a row, or that a merged party still exists.
 *
 * `PartiesService` is not here, and `PartiesModule` does not export it. That is what makes
 * this a surface rather than a suggestion — there is no way to reach the implementation, so
 * the contract cannot be widened by accident on the far side of a `dependsOn` somebody added
 * for a different reason.
 */
export { PartyDirectory } from './party-directory';
