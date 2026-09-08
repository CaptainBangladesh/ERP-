import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MARKETING_PATHS,
  type BrandSummary,
  type CreateBrandRequest,
} from '@erp/shared';
import { Button, Field, FormError, Modal, Select } from '@erp/shared/ui';
import { api, ApiFailure } from '../../../api/client';

const TIMEZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern (US)' },
  { value: 'America/Chicago', label: 'Central (US)' },
  { value: 'America/Denver', label: 'Mountain (US)' },
  { value: 'America/Los_Angeles', label: 'Pacific (US)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
] as const;

interface BrandSwitcherProps {
  brands: BrandSummary[];
  activeBrand: BrandSummary | null;
  onSelectBrand: (brand: BrandSummary) => void;
  onBrandCreated: (newBrand: BrandSummary) => void;
}

export function BrandSwitcher({
  brands,
  activeBrand,
  onSelectBrand,
  onBrandCreated,
}: BrandSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [primaryColor, setPrimaryColor] = useState('#3b82f6');
  const [storageQuotaMb, setStorageQuotaMb] = useState(1000);
  const [voiceTone, setVoiceTone] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const createBrandMutation = useMutation({
    mutationFn: (data: CreateBrandRequest) =>
      api.post<BrandSummary>(MARKETING_PATHS.brands, data),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'brands'] });
      onBrandCreated(created);
      setShowCreateModal(false);
      setName('');
      setSlug('');
      setError(null);
    },
    onError: (err) => {
      if (err instanceof ApiFailure) {
        setError(err.message);
      } else {
        setError('Failed to create brand.');
      }
    },
  });

  const submitCreate = () => {
    if (!name.trim()) {
      setError('Enter a brand name.');
      return;
    }
    createBrandMutation.mutate({
      name: name.trim(),
      slug: slug.trim() || undefined,
      timezone,
      brandColors: { primary: primaryColor },
      storageQuotaMb,
      voiceTone: voiceTone.trim() || undefined,
      productDescription: productDescription.trim() || undefined,
    });
  };

  return (
    <div className="relative inline-block text-left">
      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Switch brand"
            className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            {activeBrand?.brandColors?.primary ? (
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: activeBrand.brandColors.primary }}
              />
            ) : (
              <span className="h-3 w-3 rounded-full bg-slate-400" />
            )}
            <span className="max-w-40 truncate font-semibold">
              {activeBrand ? activeBrand.name : 'Select Brand'}
            </span>
            <span className="text-xs text-slate-400">
              ({activeBrand?.socialAccountsCount ?? 0} accounts)
            </span>
            <svg
              className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isOpen && (
            <div className="absolute left-0 z-30 mt-1.5 w-64 rounded-lg border border-slate-200 bg-white py-1.5 shadow-lg ring-1 ring-black ring-opacity-5">
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Brands / Workspaces
              </div>
              <div className="max-h-56 overflow-y-auto">
                {brands.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      onSelectBrand(b);
                      setIsOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-slate-50 ${
                      activeBrand?.id === b.id ? 'bg-slate-50 font-semibold text-slate-900' : 'text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: b.brandColors?.primary || '#94a3b8' }}
                      />
                      <span className="truncate">{b.name}</span>
                    </div>
                    <span className="ml-2 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      {b.socialAccountsCount}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-1 border-t border-slate-100 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    setShowCreateModal(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-blue-600 hover:bg-blue-50"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                  Create New Brand
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50"
        >
          + New Brand
        </button>
      </div>

      {showCreateModal && (
        <Modal
          onClose={() => setShowCreateModal(false)}
          title="Create Client Brand"
          description="A brand is one client's workspace: its own connected accounts, calendar and credentials."
          icon="🏢"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => submitCreate()}
                disabled={createBrandMutation.isPending}
              >
                {createBrandMutation.isPending ? 'Creating…' : 'Create Brand'}
              </Button>
            </>
          }
        >
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submitCreate();
            }}
            className="flex flex-col gap-4"
          >
            {error && <FormError>{error}</FormError>}

            <Field
              id="brand-name"
              label="Brand name"
              value={name}
              onChange={(value) => {
                setName(value);
                if (!slug) setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
              }}
              hint="e.g. Nike Global, Acme Studios"
            />

            <Field
              id="brand-slug"
              label="Brand slug"
              value={slug}
              onChange={setSlug}
              hint="Used in links. Left blank, it is derived from the name."
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="brand-color" className="text-sm font-medium text-slate-700">
                  Primary theme colour
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="brand-color"
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded border border-slate-200"
                  />
                  <span className="font-mono text-xs text-slate-600">{primaryColor}</span>
                </div>
              </div>

              <Select
                id="brand-timezone"
                label="Timezone"
                value={timezone}
                onChange={setTimezone}
                options={TIMEZONES}
              />
            </div>

            <Field
              id="brand-storage-quota"
              label="Storage quota (MB)"
              inputMode="numeric"
              value={String(storageQuotaMb)}
              onChange={(value) => setStorageQuotaMb(Number(value.replace(/[^0-9]/g, '')) || 0)}
            />

            {/*
              The two fields the writing assistant is allowed to know about a brand (14b).
              A closed allowlist: the prompt is assembled from these and the user's own draft,
              and never from a CRM record.
            */}
            <Field
              id="brand-voice-tone"
              label="Tone of voice"
              value={voiceTone}
              onChange={setVoiceTone}
              hint="How this brand sounds. Read by the writing assistant, nothing else."
            />

            <Field
              id="brand-product-description"
              label="What this brand sells"
              value={productDescription}
              onChange={setProductDescription}
              hint="One or two sentences. Optional."
            />

            {/* Submits on Enter; the visible actions live on the dialog's footer bar. */}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        </Modal>
      )}
    </div>
  );
}
