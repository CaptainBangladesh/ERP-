import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  PRODUCTS_ROUTE,
  type ProductListResponse,
  type ProductResponse,
} from '@erp/shared';
import { validated, type Valid } from '../../platform/validation';
import { ProductsService } from './products.service';
import {
  AddProductSupplierBody,
  CreateProductBody,
  UpdateProductBody,
} from './schemas';

/**
 * The catalogue's surface.
 *
 * Nothing is `@Public()`, and there is no `DELETE /products/:id`. The absence is the design: a
 * product is deactivated rather than deleted, so that the movements, orders and valuations
 * naming it stay intelligible. A *supplier link* is deletable, because nothing later refers to
 * one — it is a fact about today rather than a fact about a transaction.
 *
 * The list endpoint hands its whole query object to the service and names no parameter of its
 * own: `page`, `sort`, `search` and `filter.<field>` are the platform's convention, identical
 * in every module.
 */
@Controller(PRODUCTS_ROUTE)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addProduct(
    @Body(validated(CreateProductBody)) body: Valid<typeof CreateProductBody>,
  ): Promise<ProductResponse> {
    return this.products.createProduct(body);
  }

  @Get()
  async listProducts(@Query() query: Record<string, unknown>): Promise<ProductListResponse> {
    return this.products.listProducts(query);
  }

  @Get(':id')
  async product(@Param('id') id: string): Promise<ProductResponse> {
    return this.products.productDetail(id);
  }

  @Patch(':id')
  async changeProduct(
    @Param('id') id: string,
    @Body(validated(UpdateProductBody)) body: Valid<typeof UpdateProductBody>,
  ): Promise<ProductResponse> {
    return this.products.changeProduct(id, body);
  }

  /**
   * Answers with the product rather than nothing, which is why it is a 200 and not a 204: a
   * screen that has just changed who supplies something wants the suppliers it now has, and a
   * second request to find out would be a second chance for the two to disagree.
   */
  @Post(':id/suppliers')
  @HttpCode(HttpStatus.OK)
  async addSupplier(
    @Param('id') id: string,
    @Body(validated(AddProductSupplierBody)) body: Valid<typeof AddProductSupplierBody>,
  ): Promise<ProductResponse> {
    return this.products.addSupplier(id, body);
  }

  @Delete(':id/suppliers/:partyId')
  async removeSupplier(
    @Param('id') id: string,
    @Param('partyId') partyId: string,
  ): Promise<ProductResponse> {
    return this.products.removeSupplier(id, partyId);
  }
}
