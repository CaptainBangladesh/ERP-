/**
 * What the tenant root offers modules.
 *
 * A module asks the platform about the company it is acting in; it does not ask identity, and
 * it never reads the `Company` table itself. See `company-directory.ts` for why the seam is
 * this narrow.
 */
export { CompanyDirectory, type CompanyMailAccount } from './company-directory';
export { CompanyMailboxes } from './company-mailboxes';
export { CompanyRecord } from './company-record';
export { CompanyModule } from './company.module';
