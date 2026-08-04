import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MOVEMENT_PATHS } from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { InventorySettingsPage } from './InventorySettingsPage';

describe('InventorySettingsPage', () => {
  it('loads current settings and toggles allowNegativeStock', async () => {
    signedInWith();

    let updatedValue: boolean | undefined;

    server.use(
      http.get(MOVEMENT_PATHS.settings, () =>
        HttpResponse.json({ allowNegativeStock: false }),
      ),
      http.patch(MOVEMENT_PATHS.settings, async ({ request }) => {
        const body = (await request.json()) as { allowNegativeStock: boolean };
        updatedValue = body.allowNegativeStock;
        return HttpResponse.json({ allowNegativeStock: body.allowNegativeStock });
      }),
    );

    const { user } = renderPage(<InventorySettingsPage />, {
      token: 'a-token',
      path: '/inventory/settings',
    });

    const checkbox = await screen.findByRole('checkbox', {
      name: /allow negative stock levels/i,
    });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    await waitFor(() => expect(updatedValue).toBe(true));
    expect(screen.getByText(/inventory settings updated successfully/i)).toBeInTheDocument();
  });
});
