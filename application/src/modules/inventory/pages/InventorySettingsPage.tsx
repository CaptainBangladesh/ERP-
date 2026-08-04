import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MOVEMENT_PATHS, type InventorySettings } from '@erp/shared';
import { FormError } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';

export function InventorySettingsPage() {
  const queryClient = useQueryClient();
  const [successMsg, setSuccessMsg] = useState('');

  const settings = useQuery({
    queryKey: [MOVEMENT_PATHS.settings],
    queryFn: () => api.get<InventorySettings>(MOVEMENT_PATHS.settings),
  });

  const update = useMutation({
    mutationFn: (allowNegativeStock: boolean) =>
      api.patch<InventorySettings>(MOVEMENT_PATHS.settings, { allowNegativeStock }),
    onSuccess: (data) => {
      queryClient.setQueryData([MOVEMENT_PATHS.settings], data);
      setSuccessMsg('Inventory settings updated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
  });

  const failure = update.error instanceof ApiFailure ? update.error : undefined;

  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Inventory Settings</h1>
        <p className="text-sm text-slate-600">
          Configure company-wide policies for inventory control and negative stock handling.
        </p>
      </header>

      {settings.isPending ? (
        <p className="text-sm text-slate-500">Loading settings…</p>
      ) : settings.isError ? (
        <FormError>Could not load inventory settings.</FormError>
      ) : (
        <div className="flex flex-col gap-6 rounded-md border border-slate-200 bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="allow-negative-stock" className="text-sm font-medium text-slate-900">
                Allow negative stock levels
              </label>
              <p className="text-sm text-slate-600">
                When turned on, stock levels are allowed to drop below zero with a warning. When
                turned off (default), any movement or reversal driving stock negative is refused.
              </p>
            </div>
            <input
              id="allow-negative-stock"
              type="checkbox"
              checked={settings.data?.allowNegativeStock ?? false}
              disabled={update.isPending}
              onChange={(e) => {
                setSuccessMsg('');
                update.mutate(e.target.checked);
              }}
              className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
          </div>

          {failure && <FormError>{failure.message}</FormError>}
          {successMsg && (
            <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 border border-emerald-200">
              {successMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
