import { Mailer } from './mailer';

/**
 * The mailer configured for this deployment as a whole — the one chosen from the environment,
 * as opposed to one a company configured for itself.
 *
 * A distinct token so it stays reachable by name after a module rebinds `Mailer` for its own
 * messages. Identity does exactly that: its mail goes through the company's own account when
 * one is set, and falls back to *this* when it is not. Without a separate name the fallback
 * would be the very provider being overridden, which is a cycle rather than a fallback.
 */
export abstract class DeploymentMailer extends Mailer {}
