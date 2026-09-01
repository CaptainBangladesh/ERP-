# Stored files go through a platform StorageProvider that takes the company from the scope

Lead attachments needed real bytes behind them. Rather than let `crm` write to a directory, we
added `platform/storage`: a `StorageProvider` abstract class with `put` / `get` / `remove`, bound
per environment the way `MailModule` binds a mailer — `MemoryStorage` under test so a run writes
nothing to anyone's disk, `LocalFilesystemStorage` otherwise. A deployment that moves to S3
replaces one binding in `storage.module.ts`; no module changes.

The surprising part is the signature. The obvious `put(companyId, key, bytes, contentType)` is
**not** what we have — `put` takes no company, and the provider reads it from the acting tenant
scope itself. That is not a stylistic preference: the conformance pack refuses a module source
that names `companyId` at all (`hand-written-company-filter`), on the principle that a module
which writes the tenant is a module that can write the wrong one. Storage now follows the same
bargain `companyApplied` strikes for rows — the platform supplies the company, and the module
states that it does by not supplying it.

The consequences a future reader should know:

- **Storing a file outside a company scope throws.** There is no unscoped fallback, deliberately;
  a background job that ever needs to store one must enter a company with `runInCompany` first.
- **Keys are the provider's, not the caller's.** The filename a person typed never reaches a path
  — it is stored in the database column that exists for it, and the disk sees a uuid under a
  company prefix. A name arriving over HTTP containing `..` is how an upload writes somewhere it
  should not.
- **`StorageProvider` has no test of its own.** It is exercised through the file endpoints in
  `crm-lead-workspace.spec.ts`, which upload bytes and download them back. A store the endpoints
  cannot round-trip through does not work, whatever a direct unit test would say.
