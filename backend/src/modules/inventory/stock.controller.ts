import { Controller, Get, Query } from '@nestjs/common';
import { STOCK_ROUTE, type ReconciliationResult, type StockListResponse, type StockValuationSummary } from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { StockService } from './stock.service';

/**
 * What there is, right now.
 *
 * Stock levels are the running totals derived from recorded ledger movements.
 * Includes on-demand reconciliation check endpoint `GET /api/stock/reconcile` (Ticket 12)
 * and stock valuation endpoint `GET /api/stock/valuation` (Ticket 13).
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

  /**
   * On-demand reconciliation check to prove stored stock levels match the append-only ledger.
   */
  @Get('reconcile')
  @RequirePermission('inventory:stock:read')
  async reconcile(): Promise<ReconciliationResult> {
    return this.stock.reconcile();
  }

  /**
   * Calculates total stock valuation across the company, broken down by product and location (Ticket 13).
   */
  @Get('valuation')
  @RequirePermission('inventory:stock:read')
  async getValuation(): Promise<StockValuationSummary> {
    return this.stock.getValuation();
  }
}
