import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ERROR_CODES,
  PARTY_PATHS,
  SUGGESTED_PARTY_ROLES,
  type AddPartyRoleRequest,
  type CreatePartyAddressRequest,
  type MergePartiesRequest,
  type PartyResponse,
  type PartySummary,
  type UpdatePartyRequest,
} from '@erp/shared';
import { Field, FormError } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';

/**
 * One party, and everything that can be done to it.
 *
 * A panel rather than a page of its own because everything here is an edit to a row that is
 * visible in the list behind it — adding a role, adding an address, merging a duplicate away
 * — and each of those changes what the list says. Navigating to a separate screen and back
 * would make every one of them a round trip through a page the user did not want to leave.
 *
 * Every action answers with the whole party, so the panel never patches its own copy from
 * what it *thinks* happened: it renders what the server said.
 */
export function PartyDetail({
  partyId,
  knownRoles,
  candidates,
  onClose,
  onChanged,
}: {
  partyId: string;
  /** Roles already in use in this company, offered as suggestions. */
  knownRoles: string[];
  /** Parties this one could be a duplicate of. */
  candidates: PartySummary[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();

  const party = useQuery({
    queryKey: ['parties', 'detail', partyId],
    queryFn: () => api.get<PartyResponse>(PARTY_PATHS.party(partyId)),
  });

  /**
   * Every action on this panel, sharing one pending state and one error.
   *
   * They are the same kind of thing from the user's point of view — a change to this party,
   * which answers with this party — so giving each its own mutation would mean five copies
   * of the same success handler and five places for one of them to forget to refresh.
   */
  const change = useMutation({
    mutationFn: (act: () => Promise<PartyResponse>) => act(),
    onSuccess: (updated) => {
      queryClient.setQueryData(['parties', 'detail', partyId], updated);
      onChanged();
    },
  });

  const failure = change.error instanceof ApiFailure ? change.error : undefined;
  const fields = failure?.fields ?? {};
  const detail = party.data;

  if (party.isPending) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p role="status" className="text-sm text-slate-500">
          Loading party…
        </p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p role="alert" className="text-sm text-red-700">
          {party.error instanceof ApiFailure
            ? party.error.message
            : 'That party could not be loaded.'}
        </p>
      </section>
    );
  }

  const active = detail.status === 'active';
  const merged = detail.status === 'merged';

  return (
    <section
      aria-labelledby="party-detail"
      className="flex flex-col gap-6 rounded-md border border-slate-200 bg-white p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="party-detail" className="text-lg font-semibold text-slate-900">
            {detail.name}
          </h2>
          <p className="text-sm text-slate-600">
            {detail.kind === 'person' ? 'Person' : 'Organisation'}
            {detail.organisationName ? ` at ${detail.organisationName}` : ''}
            {detail.email ? ` · ${detail.email}` : ''}
            {detail.phone ? ` · ${detail.phone}` : ''}
          </p>
          {merged && (
            <p className="text-sm text-amber-700">
              This record was merged into another and is kept so that older history still
              resolves. It cannot be edited.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {!merged && (
            <button
              type="button"
              disabled={change.isPending}
              onClick={() =>
                change.mutate(() =>
                  api.patch<PartyResponse>(PARTY_PATHS.party(partyId), {
                    status: active ? 'inactive' : 'active',
                  } satisfies UpdatePartyRequest),
                )
              }
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
            >
              {active ? 'Deactivate' : 'Reactivate'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </header>

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      {!merged && (
        <>
          <Details
            party={detail}
            fields={fields}
            pending={change.isPending}
            onSave={(update) =>
              change.mutate(() =>
                api.patch<PartyResponse>(PARTY_PATHS.party(partyId), update),
              )
            }
          />

          <Roles
            roles={detail.roles}
            known={knownRoles}
            error={fields.role}
            pending={change.isPending}
            onAdd={(role) =>
              change.mutate(() =>
                api.post<PartyResponse>(PARTY_PATHS.partyRoles(partyId), {
                  role,
                } satisfies AddPartyRoleRequest),
              )
            }
            onRemove={(role) =>
              change.mutate(() =>
                api.delete<PartyResponse>(PARTY_PATHS.partyRole(partyId, role)),
              )
            }
          />

          <Addresses
            addresses={detail.addresses}
            fields={fields}
            pending={change.isPending}
            onAdd={(address) =>
              change.mutate(() =>
                api.post<PartyResponse>(PARTY_PATHS.addresses(partyId), address),
              )
            }
            onRemove={(addressId) =>
              change.mutate(() =>
                api.delete<PartyResponse>(PARTY_PATHS.address(partyId, addressId)),
              )
            }
          />

          {detail.members.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-slate-900">People here</h3>
              <ul className="flex flex-col gap-1 text-sm text-slate-700">
                {detail.members.map((member) => (
                  <li key={member.id}>{member.name}</li>
                ))}
              </ul>
            </div>
          )}

          <Merge
            candidates={candidates.filter(
              (candidate) => candidate.id !== partyId && candidate.kind === detail.kind,
            )}
            pending={change.isPending}
            onMerge={(duplicateId) =>
              change.mutate(() =>
                api.post<PartyResponse>(PARTY_PATHS.merge(partyId), {
                  duplicateId,
                } satisfies MergePartiesRequest),
              )
            }
          />
        </>
      )}
    </section>
  );
}

/**
 * Name, email and phone — the details somebody actually gets wrong when typing a customer
 * in for the first time.
 *
 * Editable, and that is not a nicety. A party is never deleted here, so a misspelled name is
 * a record that has to be corrected rather than replaced; without this the only remedy would
 * be a second party and a merge, which is a lot of ceremony for a missing letter.
 *
 * Behind a button, unlike the roles and addresses beside it, because reading a party's
 * details is the common case and editing them is not: a panel that opened with three filled
 * text boxes would look like a form somebody had left half-finished.
 */
function Details({
  party,
  fields,
  pending,
  onSave,
}: {
  party: PartyResponse;
  fields: Record<string, string>;
  pending: boolean;
  onSave: (update: UpdatePartyRequest) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: party.name,
    email: party.email ?? '',
    phone: party.phone ?? '',
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  if (!editing) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            // Reset from the party rather than from whatever was typed and abandoned last
            // time, so opening the form twice does not offer a stale draft as the truth.
            setForm({ name: party.name, email: party.email ?? '', phone: party.phone ?? '' });
            setEditing(true);
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Edit details
        </button>
      </div>
    );
  }

  return (
    <form
      noValidate
      aria-labelledby="edit-details"
      className="flex flex-col gap-4 rounded-md border border-slate-200 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        // Empty is left out rather than sent blank. The endpoint reads an absent field as
        // "do not touch it" and would refuse an empty one, so a party with no phone number
        // stays a party with no phone number instead of becoming a validation failure.
        onSave({
          name: form.name,
          ...(form.email ? { email: form.email } : {}),
          ...(form.phone ? { phone: form.phone } : {}),
        });
        setEditing(false);
      }}
    >
      <h3 id="edit-details" className="text-sm font-medium text-slate-900">
        Details
      </h3>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-48 flex-1">
          <Field id="detail-name" label="Name" value={form.name} error={fields.name} onChange={set('name')} />
        </div>
        <div className="min-w-48 flex-1">
          <Field
            id="detail-email"
            label="Email"
            type="email"
            value={form.email}
            error={fields.email}
            onChange={set('email')}
          />
        </div>
        <div className="min-w-48 flex-1">
          <Field id="detail-phone" label="Phone" value={form.phone} error={fields.phone} onChange={set('phone')} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Save details
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The roles a party holds, added and removed without recreating anything.
 *
 * The input is free text with suggestions rather than a fixed dropdown, and that is the
 * screen honouring the same rule the module does: there is no list of permitted roles
 * anywhere, so a screen that offered a closed set would be inventing one. What it offers are
 * the roles already in use here, plus the handful the system has needed so far.
 */
function Roles({
  roles,
  known,
  error,
  pending,
  onAdd,
  onRemove,
}: {
  roles: string[];
  known: string[];
  error?: string;
  pending: boolean;
  onAdd: (role: string) => void;
  onRemove: (role: string) => void;
}) {
  const [role, setRole] = useState('');
  const held = new Set(roles);
  const suggestions = [...new Set([...known, ...SUGGESTED_PARTY_ROLES])]
    .filter((candidate) => !held.has(candidate))
    .sort();

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-slate-900">Roles</h3>

      {roles.length === 0 ? (
        <p className="text-sm text-slate-600">
          No roles yet. A role is what this party is to you — a customer, a supplier.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {roles.map((assigned) => (
            <li
              key={assigned}
              className="flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm text-slate-900"
            >
              {assigned}
              <button
                type="button"
                disabled={pending}
                aria-label={`Remove role ${assigned}`}
                onClick={() => onRemove(assigned)}
                className="rounded-full px-2 text-slate-500 hover:text-slate-900 disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        noValidate
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!role.trim()) return;
          onAdd(role.trim().toLowerCase());
          setRole('');
        }}
      >
        <div className="min-w-56">
          <Field id="party-role" label="Add a role" value={role} error={error} onChange={setRole} />
        </div>
        <datalist id="party-role-suggestions">
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Add role
        </button>
      </form>
    </div>
  );
}

/** Where a party can be written to. Several, because a registered office is not a warehouse. */
function Addresses({
  addresses,
  fields,
  pending,
  onAdd,
  onRemove,
}: {
  addresses: PartyResponse['addresses'];
  fields: Record<string, string>;
  pending: boolean;
  onAdd: (address: CreatePartyAddressRequest) => void;
  onRemove: (addressId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    label: '',
    line1: '',
    line2: '',
    city: '',
    postcode: '',
    country: '',
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-slate-900">Addresses</h3>

      {addresses.length === 0 ? (
        <p className="text-sm text-slate-600">No addresses yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="flex items-start justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm text-slate-700"
            >
              <div>
                <p className="font-medium text-slate-900">
                  {address.label}
                  {address.primary ? ' · main' : ''}
                </p>
                <p>
                  {[address.line1, address.line2, address.city, address.postcode, address.country]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                aria-label={`Remove address ${address.label}`}
                onClick={() => onRemove(address.id)}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form
          noValidate
          aria-labelledby="add-address"
          className="flex flex-col gap-4 rounded-md border border-slate-200 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            onAdd({
              ...form,
              // Empty is absent rather than blank: most addresses have no second line, and
              // storing '' would put a row in the database claiming one that is empty.
              line2: form.line2 || undefined,
              // The first address a party has is its main one without anybody saying so.
              primary: addresses.length === 0,
            });
            setForm({ label: '', line1: '', line2: '', city: '', postcode: '', country: '' });
            setAdding(false);
          }}
        >
          <h4 id="add-address" className="text-sm font-medium text-slate-900">
            Add an address
          </h4>
          <div className="flex flex-wrap gap-4">
            <div className="min-w-48 flex-1">
              <Field id="address-label" label="What it is for" value={form.label} error={fields.label} onChange={set('label')} />
            </div>
            <div className="min-w-48 flex-1">
              <Field id="address-line1" label="Address" value={form.line1} error={fields.line1} onChange={set('line1')} />
            </div>
            <div className="min-w-48 flex-1">
              <Field id="address-line2" label="Second line" value={form.line2} error={fields.line2} onChange={set('line2')} />
            </div>
            <div className="min-w-48 flex-1">
              <Field id="address-city" label="Town or city" value={form.city} error={fields.city} onChange={set('city')} />
            </div>
            <div className="min-w-48 flex-1">
              <Field id="address-postcode" label="Postcode" value={form.postcode} error={fields.postcode} onChange={set('postcode')} />
            </div>
            <div className="min-w-48 flex-1">
              <Field id="address-country" label="Country" value={form.country} error={fields.country} onChange={set('country')} />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              Save address
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Add an address
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Two records, one real-world entity.
 *
 * The party on screen is the one that survives, and the control says so: what is chosen is
 * the record that goes away. Getting that round the wrong way is the mistake this is most
 * likely to produce, and it is not one anybody can undo from here.
 */
function Merge({
  candidates,
  pending,
  onMerge,
}: {
  candidates: PartySummary[];
  pending: boolean;
  onMerge: (duplicateId: string) => void;
}) {
  const [duplicateId, setDuplicateId] = useState('');

  if (candidates.length === 0) return null;

  return (
    <form
      noValidate
      aria-labelledby="merge-party"
      className="flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (duplicateId) onMerge(duplicateId);
        setDuplicateId('');
      }}
    >
      <div className="flex flex-col gap-1.5">
        <h3 id="merge-party" className="sr-only">
          Merge a duplicate
        </h3>
        <label htmlFor="merge-duplicate" className="text-sm font-medium text-slate-900">
          Merge a duplicate into this party
        </label>
        <select
          id="merge-duplicate"
          value={duplicateId}
          onChange={(event) => setDuplicateId(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/20"
        >
          <option value="">Choose a duplicate…</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending || !duplicateId}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
      >
        Merge in
      </button>
    </form>
  );
}
