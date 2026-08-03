import type { PartySummary } from '@erp/shared';

/**
 * What every other module may ask of the address book.
 *
 * The first real public surface in the system, and the shape the next thirty-nine copy. Sales
 * needs a customer's name beside an order; Purchase needs a supplier's; Inventory needs to
 * know a delivery is going to somebody real. All three of those are *reads of a party*, and
 * none of them is a reason to know that parties are stored in three tables, that a role is a
 * row, or that a merged party is a row pointing at another one.
 *
 * An abstract class rather than an interface, for the same reason `SessionAuthority` is one:
 * it is the injection token and the contract at once, so a consumer names this and never
 * `PartiesService`. `PartiesService` is not exported by `PartiesModule` and not re-exported
 * here, which is what makes "and nothing else" true rather than encouraged.
 *
 * The methods are deliberately few. Every one of them exists because a module will need it;
 * none of them is a query language. A module that finds itself wanting to filter parties by
 * something arbitrary is a module that wants the parties list screen, or a module that has
 * found a genuine gap in this contract — and both of those are conversations, which is
 * exactly what a narrow surface is for.
 */
export abstract class PartyDirectory {
  /**
   * One party, or `undefined` if this company has no such record.
   *
   * **Follows merges.** Asking for a party that turned out to be a duplicate answers with the
   * one that survived, rather than with a record marked `merged` or with nothing. That is the
   * whole point of keeping the merged row: a three-year-old order naming the duplicate still
   * resolves to the right customer, and no module has to know that a merge ever happened.
   */
  abstract party(id: string): Promise<PartySummary | undefined>;

  /**
   * Several at once, in the order given, with anything unknown to this company left out.
   *
   * Present because the alternative is a module calling `party` in a loop over the rows of a
   * list, which is the N+1 every "just read it one at a time" contract produces by the third
   * consumer.
   */
  abstract parties(ids: readonly string[]): Promise<PartySummary[]>;

  /**
   * Everybody holding a role, by name — `customer`, `supplier`, whatever the asking module
   * introduced. Active parties only: a list of who to send an invoice to should not include
   * the supplier somebody deliberately deactivated last year.
   */
  abstract withRole(role: string): Promise<PartySummary[]>;
}
