/**
 * The tenant root, as anything other than its owner may read it.
 *
 * `Company` is not an ordinary table. The platform already treats it as its own — tenancy
 * scopes every query by it and `company-owned.ts` calls it "the tenant root, which *is* the
 * company" — so the handful of facts other modules legitimately need about it belong on a
 * platform seam rather than on an import of whichever module happens to administer them.
 *
 * The alternative that was tried first is what makes the case for this one: CRM read
 * `prisma.company` directly for the owner and the company's SMTP settings, which bound it to
 * identity's schema without either module declaring an edge, and left identity mirroring rows
 * back into a CRM table to compensate. Both directions were refused by the conformance pack,
 * and rightly — the dependency was real and invisible.
 *
 * Deliberately narrow. This is not "the Company record"; it is the two things a module that
 * is not identity has a reason to ask. Anything wider would become the back door the direct
 * queries already were.
 */

/**
 * The company's own outgoing mail, in stored form.
 *
 * `smtpPassword` is the column as it sits — encrypted. Decryption belongs to whoever sends,
 * and a seam that handed back plaintext would make every caller a place a secret can leak
 * from. `null` throughout means "not configured", which is ordinary rather than exceptional:
 * a company that has said nothing about mail falls back to the deployment's.
 */
export interface CompanyMailAccount {
  fromAddress: string | null;
  fromName: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUsername: string | null;
  smtpPassword: string | null;
}

export abstract class CompanyDirectory {
  /**
   * Who owns the company in scope, or `null` when there is no company — which happens on the
   * unauthenticated paths and is not an error.
   */
  abstract ownerUserId(): Promise<string | null>;

  /** The company's stored mail account, or `null` when none is in scope. */
  abstract mailAccount(): Promise<CompanyMailAccount | null>;

  /**
   * Replaces the stored mail account wholesale.
   *
   * Every field is written, including the nulls, so that saving a partially-filled account
   * cannot leave half of a previous one behind for a send to pick up.
   */
  abstract saveMailAccount(account: CompanyMailAccount): Promise<void>;
}
