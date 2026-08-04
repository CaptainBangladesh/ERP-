import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { STOCK_PATHS, type StockValuationSummary } from '@erp/shared';
import { renderPage, signedInWith } from '../../../test/render';
import { server } from '../../../test/server';
import { ValuationPage } from './ValuationPage';

describe('ValuationPage', () => {
  it('renders loading state initially', async () => {
    signedInWith();
    server.use(
      http.get(STOCK_PATHS.valuation, () => new Promise(() => {})), // Never resolves
    );

    renderPage(<ValuationPage />, { path: '/valuation' });
    expect(screen.queryByText('Stock Valuation Error')).not.toBeInTheDocument();
  });

  it('renders empty valuation state when company has no stock', async () => {
    signedInWith();
    server.use(
      http.get(STOCK_PATHS.valuation, () =>
        HttpResponse.json<StockValuationSummary>({
          totalValue: null,
          costedProductCount: 0,
          uncostedProductCount: 0,
          totalProducts: 0,
          byProduct: [],
          byLocation: [],
          movementAccounting: {
            stockInValue: { amount: '0.00', currency: 'GBP' },
            stockOutValue: { amount: '0.00', currency: 'GBP' },
            netMovementValue: { amount: '0.00', currency: 'GBP' },
            reconciled: true,
          },
        }),
      ),
    );

    renderPage(<ValuationPage />, { path: '/valuation' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Stock Valuation' })).toBeInTheDocument();
    });

    expect(screen.getByText('No stock found to value')).toBeInTheDocument();
  });

  it('renders stock valuation data with product and location breakdowns and GL reconciliation', async () => {
    signedInWith();
    const mockValuation: StockValuationSummary = {
      totalValue: { amount: '325.00', currency: 'GBP' },
      costedProductCount: 2,
      uncostedProductCount: 1,
      totalProducts: 3,
      byProduct: [
        {
          productId: 'p1',
          productCode: 'GADGET-1',
          productName: 'Gadget',
          unitCode: 'each',
          unitCost: { amount: '40.00', currency: 'GBP' },
          totalQuantity: '5',
          totalValue: { amount: '200.00', currency: 'GBP' },
          isCosted: true,
        },
        {
          productId: 'p2',
          productCode: 'WIDGET-1',
          productName: 'Widget',
          unitCode: 'each',
          unitCost: { amount: '12.50', currency: 'GBP' },
          totalQuantity: '10',
          totalValue: { amount: '125.00', currency: 'GBP' },
          isCosted: true,
        },
        {
          productId: 'p3',
          productCode: 'SERVICE-1',
          productName: 'Consulting Hour',
          unitCode: 'hr',
          unitCost: null,
          totalQuantity: '8',
          totalValue: null,
          isCosted: false,
        },
      ],
      byLocation: [
        {
          locationId: 'loc1',
          locationCode: 'WH-1',
          locationName: 'Main Warehouse',
          totalValue: { amount: '325.00', currency: 'GBP' },
          costedProductCount: 2,
          uncostedProductCount: 1,
          items: [
            {
              productId: 'p1',
              productCode: 'GADGET-1',
              productName: 'Gadget',
              unitCode: 'each',
              unitCost: { amount: '40.00', currency: 'GBP' },
              quantity: '5',
              value: { amount: '200.00', currency: 'GBP' },
              isCosted: true,
            },
          ],
        },
      ],
      movementAccounting: {
        stockInValue: { amount: '325.00', currency: 'GBP' },
        stockOutValue: { amount: '0.00', currency: 'GBP' },
        netMovementValue: { amount: '325.00', currency: 'GBP' },
        reconciled: true,
      },
    };

    server.use(
      http.get(STOCK_PATHS.valuation, () => HttpResponse.json(mockValuation)),
    );

    const { user } = renderPage(<ValuationPage />, { path: '/valuation' });

    await waitFor(() => {
      expect(screen.getAllByText('£325.00').length).toBeGreaterThan(0);
    });

    // Check KPI counts
    expect(screen.getByText('2')).toBeInTheDocument(); // costed products count
    expect(screen.getByText('1')).toBeInTheDocument(); // uncosted products count
    expect(screen.getByText('Reconciled')).toBeInTheDocument();

    // Check Product breakdown table default view
    expect(screen.getByText('GADGET-1 — Gadget')).toBeInTheDocument();
    expect(screen.getByText('WIDGET-1 — Widget')).toBeInTheDocument();
    expect(screen.getByText('SERVICE-1 — Consulting Hour')).toBeInTheDocument();
    expect(screen.getByText('No cost recorded')).toBeInTheDocument();

    // Switch to By Location tab
    const locationTab = screen.getByRole('button', { name: /by location/i });
    await user.click(locationTab);

    expect(screen.getByText('WH-1 — Main Warehouse')).toBeInTheDocument();
  });

  it('renders error state when fetching fails', async () => {
    signedInWith();
    server.use(
      http.get(STOCK_PATHS.valuation, () =>
        HttpResponse.json({ message: 'Database failure' }, { status: 500 }),
      ),
    );

    renderPage(<ValuationPage />, { path: '/valuation' });

    await waitFor(() => {
      expect(screen.getByText('Stock Valuation Error')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
