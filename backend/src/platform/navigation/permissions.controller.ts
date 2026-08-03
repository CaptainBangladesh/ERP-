import { Controller, Get, Inject } from '@nestjs/common';
import { PERMISSIONS_PATH, type PermissionsResponse } from '@erp/shared';
import { NoPermissionRequired } from '../authorization';
import { MODULE_REGISTRY } from '../modules/registry';
import type { AssembledModules } from '../modules/manifest';

/**
 * Every permission the application currently declares, assembled from manifests rather than
 * kept anywhere central — the same claim `docs/modules.md` already makes about routes and
 * migrations, extended to the one list a role-editing screen needs.
 *
 * The catalogue of permission *strings* is not sensitive: naming `hrm:pay:read` tells nobody
 * anything they could not already infer from the module existing, the same argument ADR 0004
 * makes about a restricted field's name being public while its value is not. What is gated is
 * creating or editing a role, not reading the list of things a role could hold.
 */
@Controller()
export class PermissionsController {
  constructor(
    @Inject(MODULE_REGISTRY) private readonly registry: AssembledModules,
  ) {}

  @Get(PERMISSIONS_PATH.replace(/^\//, ''))
  @NoPermissionRequired(
    'The catalogue of permission strings carries no information a role-editing screen must be ' +
      'specially trusted with; only creating or changing a role is gated.',
  )
  permissions(): PermissionsResponse {
    return { permissions: [...this.registry.permissions] };
  }
}
