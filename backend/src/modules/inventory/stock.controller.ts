import { Controller, Get, Query } from '@nestjs/common';
import { STOCK_ROUTE, type StockListResponse } from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { StockService } from './stock.service';

/**
 * What there is, right now.
 *
 * One endpoint and one verb. Stock is never written through an API — it is written by recording
 * a movement, in the same transaction, and an endpoint that could set a level directly would be
 * a way to change what the business owns without saying what happened. Ticket 10's adjustment is
 * the supported way to make the number say something different, and it is a movement with a
 * mandatory reason precisely because that is the honest shape of it.
 *
 * Guarded by its own permission rather than by the movements one. Somebody who needs to know
 * what is on the shelf is not thereby somebody who should read the audit trail of everything
 * that has ever happened to it, and a warehouse manager reading levels all day is a different
 * job from a clerk recording arrivals.
 */
@Controller(STOCK_ROUTE)
export class StockController {
  constructor(private readonly stock: StockService) {}

  /**
   * Both of the ticket's questions — everywhere one product is, and everything one location
   * holds — are this one list with `?filter.productId=` or `?filter.locationId=` set. The
   * filtering is the platform's convention and costs this module nothing.
   */
  @Get()
  @RequirePermission('inventory:stock:read')
  async listStock(@Query() query: Record<string, unknown>): Promise<StockListResponse> {
    return this.stock.listStock(query);
  }
}
