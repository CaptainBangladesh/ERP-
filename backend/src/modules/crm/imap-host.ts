/**
 * The IMAP host for a mailbox given its SMTP host.
 *
 * Private Email, Fastmail and most hosts answer both on one name, so it is used as-is. The
 * `smtp.`/`imap.` split that Gmail and a few others use is handled by swapping the prefix — the
 * one transformation that is right when it applies and harmless when it does not.
 *
 * Its own file because two unrelated callers need the same answer: the poll, to open the
 * connection, and the mail diagnostics, to probe the port a poll would use. Putting it in
 * either would make the other import a neighbour it has nothing else to do with.
 */
export function imapHostFor(smtpHost: string): string {
  if (smtpHost.startsWith('smtp.')) return `imap.${smtpHost.slice('smtp.'.length)}`;
  return smtpHost;
}
