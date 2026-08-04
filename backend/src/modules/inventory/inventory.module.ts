import { Module } from '@nestjs/common';
import { ProductsModule } from '../products';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { MovementsController } from './movements.controller';
import { MovementsService } from './movements.service';
import { InventoryReferences } from './references';
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
 * Exports nothing, still. Sales needs to know what is available to promise and Purchase needs
 * somewhere to receive into, so a stock-levels contract is the obvious next thing in `index.ts`
 * — but neither module exists, and a contract written before its first consumer is a guess
 * about what they will ask. What inventory offers the rest of the system today is an *event*,
 * which is the other half of the seam and needs no export: a listener binds to a name in the
 * wire contract rather than to a class here.
 */
@Module({
  imports: [ProductsModule],
  controllers: [LocationsController, MovementsController, StockController],
  providers: [LocationsService, MovementsService, StockService, InventoryReferences],
})
export class InventoryModule {}
