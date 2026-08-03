/**
 * Authorization: which permission a handler requires, and the guard that checks it.
 *
 * `platform/auth` answers "who is this?" and `platform/tenancy` answers "what company, and
 * what do they hold?"; this is where the two meet a specific endpoint. A module imports
 * `RequirePermission` and, rarely, `NoPermissionRequired` — never the guard itself, which is
 * wired once in `platform/modules/application.module.ts`.
 */
export { RequirePermission, PERMISSION_KEY } from './require-permission.decorator';
export { NoPermissionRequired, NO_PERMISSION_KEY } from './no-permission-required.decorator';
export { AccessGuard } from './access.guard';
export { forbidden, moduleUnavailable } from './refusals';
