/**
 * Where a stored file's bytes actually live.
 *
 * The one thing a module needs from object storage and nothing more: put some bytes, get them
 * back by the key that was handed out, remove them. Modules depend on this and never on a
 * filesystem path or a bucket name, which is what makes the concrete store swappable — a
 * deployment that moves to S3 replaces the binding in `storage.module.ts` and `crm` does not
 * change a line.
 *
 * Note what `put` does *not* take: a company. Objects are separated per tenant, but the module
 * storing one no longer names the tenant to say so — the provider takes it from the acting
 * scope, on the same principle `companyApplied` writes rows by. A module that passed the
 * company would be a module that could pass the wrong one.
 */
export abstract class StorageProvider {
  /**
   * Stores bytes and answers with the opaque key they can be fetched back by. The filename is
   * for the store's own use (a hint, an extension); it is never a path, and callers keep the
   * name a person typed in the database column that exists for it.
   */
  abstract put(filename: string, bytes: Buffer, contentType: string): Promise<string>;

  /** The bytes stored under a key, or `undefined` if nothing is there. */
  abstract get(key: string): Promise<Buffer | undefined>;

  /** Removes a stored object. Removing one that is already gone is not an error. */
  abstract remove(key: string): Promise<void>;
}

/**
 * The company an object is being stored for, or a refusal.
 *
 * Shared by every implementation because the rule is the seam's, not any one store's: there is
 * no unscoped fallback, deliberately. A file stored with no tenant would be a file no tenant
 * could be told about, and the bug would surface as somebody else's attachment.
 */
export function storingCompany(tenancy: { current: () => { companyId: string } | undefined }): string {
  const context = tenancy.current();
  if (!context) {
    throw new Error('A file was stored outside a company scope. Every stored object belongs to one.');
  }
  return context.companyId;
}
