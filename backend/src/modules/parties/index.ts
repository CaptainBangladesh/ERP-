/**
 * The address book's public surface.
 *
 * Two exports, and between them they are the whole of what another module may name about
 * parties. Sales, Purchase, Inventory and Products all read parties through this; none of them
 * knows that a party is three tables, that a role is a row, or that a merged party still
 * exists.
 *
 * `PartyDirectory` is the contract. `PartiesModule` is here because Nest's container requires
 * it: a module that injects the contract has to import the module that provides it, so a
 * surface offering only the abstract class would be a surface nobody could actually use. It
 * grants nothing extra — `PartiesModule` exports `PartyDirectory` alone, and deliberately not
 * `PartiesService`, so there is still no way to reach the implementation even with the
 * dependency declared.
 *
 * That distinction is why both are here rather than the module being reached for directly at
 * `parties/parties.module`: the file *is* the surface, and importing past it is refused.
 */
export { PartyDirectory } from './party-directory';
export { PartiesModule } from './parties.module';
