import { Module } from '@nestjs/common';
import { PartiesModule } from '../parties';
import { ProductCatalogue } from './product-catalogue';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';

/**
 * Products and units of measure.
 *
 * Imports `PartiesModule`, which exports `PartyDirectory` and not `PartiesService` — so what
 * arrives here is the contract and not the implementation. That is the declared dependency
 * made real: products can read a party and cannot reach the address book's tables, its merge
 * logic, or its validation.
 *
 * Exports `ProductCatalogue`, bound to the service with `useExisting` so that the controllers
 * and the contract are the same instance. Two would be two caches, two transactions' worth of
 * state, and eventually two answers. `ProductsService` itself is not exported, which is what
 * makes `index.ts` a surface rather than a suggestion.
 */
@Module({
  imports: [PartiesModule],
  controllers: [ProductsController, UnitsController],
  providers: [
    ProductsService,
    UnitsService,
    { provide: ProductCatalogue, useExisting: ProductsService },
  ],
  exports: [ProductCatalogue],
})
export class ProductsModule {}
