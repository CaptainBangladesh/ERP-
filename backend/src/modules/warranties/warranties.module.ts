import { Module } from '@nestjs/common';
import { ProductsModule } from '../products';
import { WarrantiesController } from './warranties.controller';
import { WarrantiesService } from './warranties.service';

/**
 * Warranties.
 *
 * Imports `ProductsModule`, which exports `ProductCatalogue` and not `ProductsService` — so
 * what arrives here is the contract and not the implementation. That is `dependsOn: ['products']`
 * made real: warranties can read a product and cannot reach the catalogue's tables, its
 * unit-conversion logic, or its validation.
 *
 * Exports nothing. Nothing depends on the add-on stub, and nothing should have a reason to.
 */
@Module({
  imports: [ProductsModule],
  controllers: [WarrantiesController],
  providers: [WarrantiesService],
})
export class WarrantiesModule {}
