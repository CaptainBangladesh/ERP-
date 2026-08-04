import { Module } from '@nestjs/common';
import { ProductsModule } from '../products';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { MovementsController } from './movements.controller';
import { MovementsService } from './movements.service';
import { InventoryReferences } from './references';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { StockValuation } from './stock-valuation';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

/**
 * Inventory.
 *
 * Imports `ProductsModule` for the first time, which is the declared dependency finally being
 * used: what arrives is `ProductCatalogue` and not `ProductsService`, because that is all
 * `ProductsModule` exports. So a movement can resolve what moved and in what unit, and cannot
 * reach a products table, its validation, or its unit conversion internals. Locations alone
 * never needed it; a movement is the thing that names a product.
 *
 * Exports `StockValuation`, the public contract for inventory valuation (Ticket 13), bound to `StockService`.
 */
@Module({
  imports: [ProductsModule],
  controllers: [LocationsController, MovementsController, StockController, SettingsController],
  providers: [
    LocationsService,
    MovementsService,
    StockService,
    SettingsService,
    InventoryReferences,
    {
      provide: StockValuation,
      useExisting: StockService,
    },
  ],
  exports: [StockValuation],
})
export class InventoryModule {}
