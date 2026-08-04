import type { StockValuationSummary } from '@erp/shared';

/**
 * What a future Accounting module (or any internal consumer) asks of Inventory for stock valuation.
 *
 * Exposes total stock value across the company, broken down by product and location,
 * along with general ledger movement accounting reconciliation.
 */
export abstract class StockValuation {
  /**
   * Retrieves current stock valuation for the company, including product breakdown,
   * location breakdown, and movement accounting reconciliation.
   */
  abstract getValuation(): Promise<StockValuationSummary>;
}
