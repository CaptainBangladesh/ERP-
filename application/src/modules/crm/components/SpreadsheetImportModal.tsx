import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  isAuthenticationFailure,
  LEAD_FIELD_PATHS,
  LEAD_FIELD_TYPES,
  LEAD_IMPORT_PATHS,
  type CreateLeadFieldRequest,
  type LeadFieldResponse,
  type LeadFieldSummary,
  type LeadFieldType,
  type LeadImportCommitResponse,
  type LeadImportDryRunResponse,
  type LeadImportRejectedRow,
} from '@erp/shared';
import { Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { navigate } from '../../../app/location';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { LEAD_VOCABULARY_KEY, useLeadFields, useLeadGroups, useLeadSources } from '../vocabulary';

interface SpreadsheetImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'upload' | 'mapping' | 'preview' | 'success';

export function SpreadsheetImportModal({
  isOpen,
  onClose,
  onSuccess,
}: SpreadsheetImportModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetCount, setSheetCount] = useState<number>(1);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaultGroupId, setDefaultGroupId] = useState<string>('');
  const [defaultSourceId, setDefaultSourceId] = useState<string>('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dryRunResult, setDryRunResult] = useState<LeadImportDryRunResponse | null>(null);
  const [commitResult, setCommitResult] = useState<LeadImportCommitResponse | null>(null);

  // For quick custom field creation inside import modal
  const [quickCreateHeader, setQuickCreateHeader] = useState<string | null>(null);
  const [createdFields, setCreatedFields] = useState<LeadFieldSummary[]>([]);

  const { session } = useSession();
  const canWriteLeadFields = hasPermission(session, 'crm:lead-fields:write');

  const { active: customFields = [] } = useLeadFields();
  const { groups = [] } = useLeadGroups();
  const { sources = [] } = useLeadSources();

  const allCustomFields = useMemo(() => {
    const map = new Map<string, LeadFieldSummary>();
    if (Array.isArray(customFields)) {
      for (const cf of customFields) {
        if (cf && cf.key) map.set(cf.key, cf);
      }
    }
    if (Array.isArray(createdFields)) {
      for (const cf of createdFields) {
        if (cf && cf.key) map.set(cf.key, cf);
      }
    }
    return Array.from(map.values());
  }, [customFields, createdFields]);

  if (!isOpen) return null;

  function resetState() {
    setStep('upload');
    setFile(null);
    setHeaders([]);
    setSheetCount(1);
    setMapping({});
    setDefaultGroupId('');
    setDefaultSourceId('');
    setError(null);
    setDryRunResult(null);
    setCommitResult(null);
    setQuickCreateHeader(null);
    setCreatedFields([]);
  }

  function handleClose() {
    resetState();
    onClose();
  }

  async function handleFileSelect(selectedFile: File) {
    setError(null);
    const filename = selectedFile.name.toLowerCase();
    if (!filename.endsWith('.csv') && !filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      setError('Please select a CSV or XLSX spreadsheet file.');
      return;
    }

    if (selectedFile.size > 20 * 1024 * 1024) {
      setError('File is too large. Maximum allowed size is 20MB.');
      return;
    }

    setFile(selectedFile);

    try {
      const { headers: extractedHeaders, count } = await readHeadersFromFile(selectedFile);
      setHeaders(extractedHeaders);
      setSheetCount(count);

      const autoMap: Record<string, string> = {};
      for (const header of extractedHeaders) {
        const match = findBestMatch(header, allCustomFields);
        if (match) autoMap[header] = match;
      }
      setMapping(autoMap);
      setStep('mapping');
    } catch {
      setError('Could not read spreadsheet headers.');
    }
  }

  async function handleDryRun() {
    if (!file) return;
    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mapping', JSON.stringify(mapping));
      if (defaultGroupId) formData.append('groupId', defaultGroupId);
      if (defaultSourceId) formData.append('sourceId', defaultSourceId);

      const result = await api.postForm<LeadImportDryRunResponse>(
        LEAD_IMPORT_PATHS.dryRun,
        formData,
      );

      setDryRunResult(result);
      setStep('preview');
    } catch (err) {
      if (err instanceof ApiFailure) {
        setError(err.message);
      } else {
        setError('Dry run failed. Please check your file and mapping.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCommit() {
    if (!file) return;
    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mapping', JSON.stringify(mapping));
      if (defaultGroupId) formData.append('groupId', defaultGroupId);
      if (defaultSourceId) formData.append('sourceId', defaultSourceId);

      const result = await api.postForm<LeadImportCommitResponse>(
        LEAD_IMPORT_PATHS.commit,
        formData,
      );

      setCommitResult(result);
      setStep('success');
      onSuccess();
    } catch (err) {
      if (err instanceof ApiFailure) {
        setError(err.message);
      } else {
        setError('Import failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl relative">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h3 className="text-base font-bold text-slate-900">Import Leads from Spreadsheet</h3>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {error && (
          error.includes('expired') || error.includes('Sign in') || error.includes('unauthenticated') ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-center">
              <p className="text-xs font-semibold text-rose-700">{error}</p>
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  navigate('/sign-in');
                }}
                className="rounded bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-teal-800 transition"
              >
                Sign In Again →
              </button>
            </div>
          ) : (
            <FormError>{error}</FormError>
          )
        )}

        {step === 'upload' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-600">
              Upload a CSV or XLSX spreadsheet of leads. Multi-sheet Excel workbooks are automatically scanned across all sheets. If a category/group does not exist yet, it will be created automatically.
            </p>

            <label className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center cursor-pointer transition hover:bg-slate-100">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFileSelect(f);
                }}
              />
              <div className="text-sm font-semibold text-teal-700">Click to choose file</div>
              <div className="mt-1 text-xs text-slate-500">CSV or XLSX (Multi-sheet supported)</div>
            </label>
          </div>
        )}

        {step === 'mapping' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>File: <strong className="text-slate-800">{file?.name}</strong> ({headers.length} headers detected)</span>
              <div className="flex items-center gap-2">
                {sheetCount > 1 && <span className="rounded bg-teal-50 px-2 py-0.5 font-semibold text-teal-700">{sheetCount} Sheets Found</span>}
                {canWriteLeadFields && (
                  <button
                    type="button"
                    onClick={() => setQuickCreateHeader('Custom Field')}
                    className="rounded border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-100 transition"
                  >
                    ➕ Add Custom Field
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto rounded border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 font-semibold text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="p-2">Spreadsheet Header</th>
                    <th className="p-2">Lead Field</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {headers.map((header) => (
                    <tr key={header}>
                      <td className="p-2 font-medium text-slate-800">{header}</td>
                      <td className="p-2">
                        <select
                          value={mapping[header] || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '__CREATE_NEW__') {
                              setQuickCreateHeader(header);
                            } else {
                              setMapping((prev) => ({
                                ...prev,
                                [header]: val,
                              }));
                            }
                          }}
                          className="w-full rounded border border-slate-300 p-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-600"
                        >
                          <option value="">-- Do Not Import --</option>
                          <optgroup label="Built-in Fields">
                            <option value="name">Name / Shop Name (Required)</option>
                            <option value="email">Email Address</option>
                            <option value="organisationName">Organization Name</option>
                            <option value="phone">Phone Number</option>
                            <option value="groupId">Group / Category (Auto-Creates if New)</option>
                            <option value="sourceId">Lead Source</option>
                            <option value="assignedToUserId">Assigned User ID</option>
                          </optgroup>
                          {allCustomFields.length > 0 && (
                            <optgroup label="Custom Fields">
                              {allCustomFields.map((field) => (
                                <option key={field.key} value={field.key}>
                                  {field.label} ({field.type})
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {canWriteLeadFields && (
                            <optgroup label="Create New">
                              <option value="__CREATE_NEW__">✨ + Create Custom Field for "{header}"...</option>
                            </optgroup>
                          )}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-3">
              <Select
                id="default-group-select"
                label="Default Fallback Group (Optional)"
                value={defaultGroupId}
                onChange={setDefaultGroupId}
                options={[
                  { value: '', label: '-- Auto / Create as Needed --' },
                  ...groups.map((g) => ({ value: g.id, label: g.name })),
                ]}
              />

              <Select
                id="default-source-select"
                label="Default Lead Source (Optional)"
                value={defaultSourceId}
                onChange={setDefaultSourceId}
                options={[
                  { value: '', label: '-- None --' },
                  ...sources.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleDryRun()}
                disabled={isLoading}
                className="rounded bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {isLoading ? 'Validating…' : 'Preview Validation'}
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && dryRunResult && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="font-semibold text-emerald-700">
                ✔ {dryRunResult.accepted} valid rows ready to import
              </div>
              {dryRunResult.rejected.length > 0 && (
                <div className="font-semibold text-rose-700">
                  ✖ {dryRunResult.rejected.length} invalid rows (will be skipped)
                </div>
              )}
            </div>

            {dryRunResult.rejected.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-semibold text-rose-900">Row Rejections Breakdown:</div>
                <div className="max-h-48 overflow-y-auto rounded border border-rose-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-rose-50 font-semibold text-rose-800 border-b border-rose-200">
                      <tr>
                        <th className="p-1.5">Row #</th>
                        <th className="p-1.5">Field</th>
                        <th className="p-1.5">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rose-100">
                      {dryRunResult.rejected.map((rej: LeadImportRejectedRow, idx: number) => (
                        <tr key={idx}>
                          <td className="p-1.5 font-semibold text-slate-700">Line {rej.row}</td>
                          <td className="p-1.5 text-slate-600">{rej.field || '-'}</td>
                          <td className="p-1.5 text-rose-700">{rej.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep('mapping')}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Back to Mapping
              </button>
              <button
                type="button"
                onClick={() => void handleCommit()}
                disabled={isLoading || dryRunResult.accepted === 0}
                className="rounded bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {isLoading ? 'Importing…' : `Commit Import (${dryRunResult.accepted} Leads)`}
              </button>
            </div>
          </div>
        )}

        {step === 'success' && commitResult && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="text-3xl">🎉</div>
            <div className="text-base font-bold text-emerald-800">Import Complete!</div>
            <div className="text-xs text-slate-600">
              Successfully imported <strong>{commitResult.accepted}</strong> leads into your CRM.
              {commitResult.rejected.length > 0 && (
                <span> ({commitResult.rejected.length} malformed rows were skipped)</span>
              )}
            </div>

            <div className="mt-3">
              <button
                type="button"
                onClick={handleClose}
                className="rounded bg-teal-700 px-5 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Close & View Board
              </button>
            </div>
          </div>
        )}
      </div>

      {quickCreateHeader && (
        <QuickAddFieldModal
          initialLabel={quickCreateHeader}
          onClose={() => setQuickCreateHeader(null)}
          onCreated={(newField) => {
            void queryClient.invalidateQueries({ queryKey: LEAD_VOCABULARY_KEY });
            setCreatedFields((prev) => [...prev, newField]);
            setMapping((prev) => {
              const updated = { ...prev };
              if (quickCreateHeader && quickCreateHeader !== 'Custom Field') {
                updated[quickCreateHeader] = newField.key;
              }
              for (const h of headers) {
                if (!updated[h] || updated[h] === '') {
                  const matchKey = findBestMatch(h, [newField]);
                  if (matchKey === newField.key) {
                    updated[h] = newField.key;
                  }
                }
              }
              return updated;
            });
            setQuickCreateHeader(null);
          }}
        />
      )}
    </div>
  );
}

function QuickAddFieldModal({
  initialLabel,
  onClose,
  onCreated,
}: {
  initialLabel: string;
  onClose: () => void;
  onCreated: (field: LeadFieldSummary) => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [type, setType] = useState<LeadFieldType>('text');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const takesOptions = type === 'select' || type === 'multiselect';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;

    setIsPending(true);
    setError(null);

    try {
      const created = await api.post<LeadFieldResponse>(LEAD_FIELD_PATHS.leadFields, {
        label: label.trim(),
        type,
        required,
        ...(takesOptions
          ? { options: options.split(',').map((o) => o.trim()).filter(Boolean) }
          : {}),
      } satisfies CreateLeadFieldRequest);

      if (created && created.key) {
        onCreated(created);
        return;
      } else {
        setError('Server did not return a valid field definition.');
      }
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.code === 'forbidden') {
          setError('You do not have permission to create lead fields (crm:lead-fields:write required).');
        } else {
          setError(err.message);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create field.');
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <h4 className="text-sm font-bold text-slate-900">Add New Custom Field</h4>
          <button type="button" onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {error && (
          error.includes('expired') || error.includes('Sign in') || error.includes('unauthenticated') ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-center">
              <p className="text-xs font-semibold text-rose-700">{error}</p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate('/sign-in');
                }}
                className="rounded bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-teal-800 transition"
              >
                Sign In Again →
              </button>
            </div>
          ) : (
            <FormError>{error}</FormError>
          )
        )}

        <Field
          id="quick-field-label"
          label="Field Name *"
          value={label}
          onChange={setLabel}
          hint="For social media links (FB, LinkedIn), leave type as Text."
        />

        <Select
          id="quick-field-type"
          label="Field Type"
          value={type}
          options={LEAD_FIELD_TYPES.map((t) => ({
            value: t,
            label: t === 'text' ? 'Text / URL / Social Link' : t,
          }))}
          onChange={(val) => setType(val as LeadFieldType)}
        />

        {takesOptions && (
          <Field
            id="quick-field-options"
            label="Options (comma separated) *"
            value={options}
            onChange={setOptions}
          />
        )}

        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <span>Required field</span>
        </label>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!label.trim() || isPending}
            className="rounded bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {isPending ? 'Creating…' : 'Create & Auto-Map'}
          </button>
        </div>
      </form>
    </div>
  );
}

function findBestMatch(header: string, customFields: LeadFieldSummary[] = []): string | null {
  if (!header) return null;
  const clean = header.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (['group', 'category', 'leadgroup', 'segment'].includes(clean)) return 'groupId';
  if (['name', 'leadname', 'fullname', 'contactname', 'shopname', 'businessname', 'title'].includes(clean)) return 'name';
  if (['phone', 'phoneno', 'phonenumber', 'contact', 'mobile', 'cell'].includes(clean)) return 'phone';
  if (['email', 'emailaddress', 'mail'].includes(clean)) return 'email';
  if (['organisation', 'organisationname', 'organization', 'organizationname', 'company', 'companyname'].includes(clean)) return 'organisationName';
  if (['source', 'leadsource', 'channel'].includes(clean)) return 'sourceId';

  if (Array.isArray(customFields)) {
    for (const cf of customFields) {
      if (!cf || !cf.key || !cf.label) continue;
      const cfLabelClean = cf.label.toLowerCase().replace(/[^a-z0-9]/g, '');
      const cfKeyClean = cf.key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        clean === cfLabelClean ||
        clean === cfKeyClean ||
        (cfLabelClean && cfLabelClean.includes(clean)) ||
        (clean && clean.includes(cfLabelClean))
      ) {
        return cf.key;
      }
    }
  }

  return null;
}

async function readHeadersFromFile(file: File): Promise<{ headers: string[]; count: number }> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const headersSet = new Set<string>();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
    if (!rows || rows.length === 0) continue;

    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = rows[i] || [];
      const text = r.map((c) => String(c).toLowerCase().trim()).join(' ');
      if (
        text.includes('category') ||
        text.includes('group') ||
        text.includes('shop') ||
        text.includes('name') ||
        text.includes('phone') ||
        text.includes('email') ||
        text.includes('lead')
      ) {
        headerIdx = i;
        break;
      }
    }

    const row = headerIdx !== -1 ? rows[headerIdx] : rows[0];
    if (row) {
      for (const cell of row) {
        const str = String(cell).trim();
        if (str) headersSet.add(str);
      }
    }
  }

  const result = Array.from(headersSet);
  if (result.length === 0) {
    return {
      headers: ['Category', 'Shop Name', 'Phone No', 'FB link', 'Email'],
      count: workbook.SheetNames.length,
    };
  }
  return { headers: result, count: workbook.SheetNames.length };
}

