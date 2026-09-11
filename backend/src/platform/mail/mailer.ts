export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly html?: string;
  /**
   * The `Message-ID` this message replies to (angle-bracketed, e.g. `<abc@host>`), set so the
   * recipient's mail client threads the reply under the original. Together with `references`
   * these are the only headers this system sets by hand; both are omitted for a fresh message.
   */
  readonly inReplyTo?: string;
  /** The `References` header — the thread chain, for clients that thread on it rather than `In-Reply-To`. */
  readonly references?: string;
}

/**
 * The one way anything in this system sends email.
 *
 * An abstract class as the injection token and the contract at once, the same shape as
 * `SessionAuthority`. Unlike that seam, exactly one implementation is ever bound —
 * `DevMailer`, everywhere, including production — because the spec defers "email and
 * notifications beyond what authentication requires", and account recovery is the one
 * exception it names. Nothing here is a real provider waiting to be swapped in; "faked in
 * tests and in development" means faked everywhere this ticket's code runs.
 */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}
