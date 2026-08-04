import { Body, Controller, Get, Patch } from '@nestjs/common';
import { INVENTORY_SETTINGS_ROUTE, type InventorySettings } from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { UpdateInventorySettingsBody } from './schemas';
import { SettingsService } from './settings.service';

/**
 * Whether this company refuses a movement that would go negative, or merely warns about it.
 *
 * Two handlers and no session parameter on either: the company is the platform's, and the
 * policy is one boolean, so there is nothing here for a caller to identify but itself.
 */
@Controller(INVENTORY_SETTINGS_ROUTE)
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  @RequirePermission('inventory:stock:read')
  async get(): Promise<InventorySettings> {
    return this.service.get();
  }

  @Patch()
  @RequirePermission('inventory:stock:write')
  async update(
    @Body(validated(UpdateInventorySettingsBody))
    body: Valid<typeof UpdateInventorySettingsBody>,
  ): Promise<InventorySettings> {
    return this.service.update(body);
  }
}
