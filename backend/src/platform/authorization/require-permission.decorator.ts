import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'erp:permission';

/**
 * Declares the one permission a caller must hold to reach this handler.
 *
 * Every non-public endpoint has exactly one of this, `@NoPermissionRequired()`, or `@Public()`
 * — the conformance pack refuses a handler with none of the three. The permission's own prefix
 * is also how `AccessGuard` finds which module the endpoint belongs to, so that tier
 * availability is checked from the same string a module already writes for an unrelated
 * reason, rather than a second declaration nothing keeps in step with the first.
 */
export const RequirePermission = (permission: string): MethodDecorator =>
  SetMetadata(PERMISSION_KEY, permission);
