/**
 * Crm's public surface.
 *
 * Empty, deliberately: this module offers other modules nothing yet. That is a real answer
 * rather than an omission, and it is the one identity and hrm give.
 *
 * When it does have something to offer, it is an abstract class declared here — the shape of
 * the question another module may ask — with the service (e.g. 'LeadsService') bound to it in
 * the Nest module, and 'CrmModule' exported beside it, because a consumer has to import
 * the module in order to inject what it provides. Everything else in this directory stays
 * internal, including the services and the tables, so this file is the whole of what the rest
 * of the system may name.
 */
export {};
