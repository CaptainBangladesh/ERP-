/**
 * Inventory's public surface.
 *
 * Empty, deliberately: this module offers other modules nothing yet. That is a real answer
 * rather than an omission, and it is the one identity and hrm give.
 *
 * It will not stay empty. Sales needs to know what is available to promise and Purchase needs
 * somewhere to receive into, so a stock-levels contract is the obvious next thing here — but
 * neither module exists, and a contract written before its first consumer is a guess about what
 * they will ask. Ticket 09 is where inventory first has something worth offering.
 *
 * When it does, it is an abstract class declared here — the shape of the question another
 * module may ask — with `LocationsService` bound to it in the Nest module, and
 * `InventoryModule` exported beside it, because a consumer has to import the module in order to
 * inject what it provides. Everything else in this directory stays internal, including the
 * services and the tables, so this file is the whole of what the rest of the system may name.
 */
export {};
