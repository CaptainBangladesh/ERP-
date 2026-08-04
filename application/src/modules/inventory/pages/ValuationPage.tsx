import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  STOCK_PATHS,
  type StockValuationSummary,
} from '@erp/shared';
import { MoneyText, QuantityText, formatMoney } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { linkProps } from '../../../app/location';

/**
 * Stock Valuation dashboard page (Ticket 13).
 *
 * Shows company-wide total inventory valuation, breakdowns by product and location,
 * explicit uncosted product handling, and general ledger movement accounting reconciliation.
 */
export function ValuationPage() {
  const [activeTab, setActiveTab] = useState<'product' | 'location'>('product');

  const valuation = useQuery({
    queryKey: ['stock', 'valuation'],
    queryFn: () => api.get<StockValuationSummary>(STOCK_PATHS.valuation),
  });

  const failure = valuation.error instanceof ApiFailure ? valuation.error : undefined;
  const data = valuation.data;

  if (valuation.isPending) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="h-8 w-48 bg-slate-200 rounded"></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-slate-100 rounded-lg"></div>
          ))}
        </div>
        <div className="h-64 bg-slate-100 rounded-lg"></div>
      </div>
    );
  }

  if (valuation.isError) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
        <h2 className="text-lg font-semibold">Stock Valuation Error</h2>
        <p className="text-sm">{failure?.message ?? 'Failed to load stock valuation.'}</p>
        <div>
          <button
            type="button"
            onClick={() => void valuation.refetch()}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const hasStock = data && data.totalProducts > 0;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-900">Stock Valuation</h1>
          <a {...linkProps('/stock')} className="text-sm font-medium text-slate-700 hover:text-slate-900 underline">
            Back to Stock
          </a>
        </div>
        <p className="text-sm text-slate-600">
          What your company stock is worth across all products and locations, with exact arithmetic and zero drift.
        </p>
      </header>

      {/* Summary KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Stock Value</span>
          <div className="mt-2 text-2xl font-bold text-slate-900">
            {data?.totalValue ? (
              <MoneyText value={data.totalValue} />
            ) : (
              <span className="text-slate-400 font-normal text-lg">Uncosted / No stock</span>
            )}
          </div>
          <span className="mt-1 text-xs text-slate-500">
            Across {data?.totalProducts ?? 0} product(s)
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Costed Products</span>
          <div className="mt-2 text-2xl font-bold text-emerald-600">
            {data?.costedProductCount ?? 0}
          </div>
          <span className="mt-1 text-xs text-slate-500">
            With recorded cost
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Uncosted Products</span>
          <div className={`mt-2 text-2xl font-bold ${data?.uncostedProductCount ? 'text-amber-600' : 'text-slate-700'}`}>
            {data?.uncostedProductCount ?? 0}
          </div>
          <span className="mt-1 text-xs text-slate-500">
            Shown as uncosted, not zero
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">General Ledger Seam</span>
          <div className="mt-2 flex items-center gap-2">
            {data?.movementAccounting.reconciled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                <svg className="h-3.5 w-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
                Reconciled
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                Divergence
              </span>
            )}
          </div>
          <span className="mt-1 text-xs text-slate-500">
            Net Movement: {data?.movementAccounting.netMovementValue ? formatMoney(data.movementAccounting.netMovementValue) : '£0.00'}
          </span>
        </div>
      </div>

      {/* Movement Accounting Reconciliation Details */}
      {data && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          <div className="flex items-center gap-6">
            <div>
              <span className="font-medium text-slate-700">Stock-in Value: </span>
              <span className="font-semibold text-slate-900">{formatMoney(data.movementAccounting.stockInValue)}</span>
            </div>
            <div>
              <span className="font-medium text-slate-700">Stock-out Value: </span>
              <span className="font-semibold text-slate-900">{formatMoney(data.movementAccounting.stockOutValue)}</span>
            </div>
            <div>
              <span className="font-medium text-slate-700">Net Movement Value: </span>
              <span className="font-semibold text-slate-900">{formatMoney(data.movementAccounting.netMovementValue)}</span>
            </div>
          </div>
          <p className="text-slate-500">
            Value derived from stock equals the exact sum of movement ledger entries.
          </p>
        </div>
      )}

      {/* Empty State */}
      {!hasStock ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">No stock found to value</h3>
          <p className="mt-1 text-sm text-slate-600">
            Stock exists once goods arrive. Use the{' '}
            <a {...linkProps('/stock')} className="font-medium text-slate-900 underline">
              Stock screen
            </a>{' '}
            to record receipts.
          </p>
        </div>
      ) : (
        /* Breakdown View Toggles & Content */
        <div className="flex flex-col gap-4">
          <div className="flex border-b border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab('product')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === 'product'
                  ? 'border-slate-900 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              By Product ({data.byProduct.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('location')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === 'location'
                  ? 'border-slate-900 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              By Location ({data.byLocation.length})
            </button>
          </div>

          {activeTab === 'product' ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Product</th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">Total Quantity</th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">Unit Cost</th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">Total Value</th>
                    <th scope="col" className="px-4 py-3 font-semibold text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.byProduct.map((p) => (
                    <tr key={p.productId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {p.productCode} — {p.productName}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="flex items-baseline justify-end gap-1">
                          <QuantityText value={p.totalQuantity} />
                          <span className="text-slate-500 text-xs">{p.unitCode}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">
                        {p.unitCost ? (
                          formatMoney(p.unitCost)
                        ) : (
                          <span className="text-slate-400 italic text-xs">No cost recorded</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                        {p.totalValue ? (
                          formatMoney(p.totalValue)
                        ) : (
                          <span className="text-slate-400 font-normal italic text-xs">Uncosted</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.isCosted ? (
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            Costed
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Uncosted
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {data.byLocation.map((loc) => (
                <div key={loc.locationId} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {loc.locationCode} — {loc.locationName}
                      </h3>
                      <span className="text-xs text-slate-500">
                        {loc.costedProductCount} costed, {loc.uncostedProductCount} uncosted items
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-slate-500 block">Location Value</span>
                      <span className="font-mono font-bold text-slate-900 text-base">
                        {loc.totalValue ? formatMoney(loc.totalValue) : 'Uncosted'}
                      </span>
                    </div>
                  </div>

                  <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
                    <thead className="bg-white text-slate-500 text-xs uppercase tracking-wider">
                      <tr>
                        <th scope="col" className="px-4 py-2 font-medium">Product</th>
                        <th scope="col" className="px-4 py-2 font-medium text-right">Quantity</th>
                        <th scope="col" className="px-4 py-2 font-medium text-right">Unit Cost</th>
                        <th scope="col" className="px-4 py-2 font-medium text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loc.items.map((item) => (
                        <tr key={item.productId} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-medium text-slate-800">
                            {item.productCode} — {item.productName}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="flex items-baseline justify-end gap-1">
                              <QuantityText value={item.quantity} />
                              <span className="text-slate-500 text-xs">{item.unitCode}</span>
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-600 text-xs">
                            {item.unitCost ? formatMoney(item.unitCost) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-medium text-slate-900 text-xs">
                            {item.value ? formatMoney(item.value) : <span className="text-slate-400 italic">Uncosted</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
