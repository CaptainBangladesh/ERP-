import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

/**
 * Inventory.
 *
 * Exports nothing. When another module needs something from this one, declare an abstract
 * class in `index.ts`, bind the service to it here with `useExisting`, and export *that* —
 * never the service, so the contract cannot be widened by accident on the far side of a
 * `dependsOn` somebody added for a different reason. Export this module from `index.ts` too,
 * because a consumer has to import it in order to inject what it provides.
 * `backend/src/modules/parties` is the worked example.
 *
 * It imports nothing either, today. `ProductsModule` arrives here in ticket 09, when a
 * movement first has to name what moved; a location does not name a product.
 */
@Module({
  controllers: [LocationsController],
  providers: [LocationsService],
})
export class InventoryModule {}
