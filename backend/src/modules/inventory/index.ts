/**
 * Inventory's public surface.
 *
 * Still empty, and now for a sharper reason than "there is nothing here yet".
 *
 * What inventory has to tell the rest of the system, it tells by *emitting* rather than by
 * being asked: `inventory.movement.recorded` carries the value and accounting classification a
 * journal entry needs, and a listener binds to that name in the wire contract without naming a
 * class in this directory at all. An announcement needs no export. That is the difference
 * between this file and `products/index.ts` — a catalogue is something you look things up in,
 * and a ledger is something that tells you what happened.
 *
 * A pull-shaped contract will still earn its place here. Sales needs to know what is available
 * to promise before it accepts an order, and Purchase needs somewhere to receive into; both are
 * questions rather than notifications, and neither module exists. A contract written before its
 * first consumer is a guess about what they will ask, and ticket 13's valuation contract — the
 * one the roadmap names explicitly — is the first with a caller behind it.
 *
 * When it does arrive, it is an abstract class declared here, bound to the service in the Nest
 * module, with `InventoryModule` exported beside it because a consumer has to import the module
 * in order to inject what it provides. Everything else in this directory stays internal,
 * including the services and the tables, so this file is the whole of what the rest of the
 * system may name.
 */
export {};
