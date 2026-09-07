/**
 * Crm's public surface.
 *
 * One contract, and it earned its place: `CrmLeadIntake` is what an inbound-marketing channel
 * asks of the CRM when it has contact data and needs a lead. It is an abstract class rather
 * than a service export — `LeadsService` is bound to it in `CrmModule`, and `CrmModule` is
 * exported beside it because a consumer has to import the module in order to inject what it
 * provides. Everything else in this directory stays internal, including the services and the
 * tables, so this file is the whole of what the rest of the system may name.
 *
 * What is deliberately *not* here is a read. Marketing wanted to write leads, not to browse
 * them; a "get me the leads" export would be a table read with a method name on it, and the
 * answer to that question stays an event.
 */
export {
  CrmLeadIntake,
  type CrmInboundActivity,
  type CrmInboundContact,
  type CrmInboundSubmission,
  type CrmIntakeActor,
  type CrmIntakeLead,
  type CrmLeadIntakeResult,
  type CrmTransaction,
} from './lead-intake';
export { CrmModule } from './crm.module';
