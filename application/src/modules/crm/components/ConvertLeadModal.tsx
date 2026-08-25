import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ERROR_CODES,
  LEAD_PATHS,
  PARTY_PATHS,
  listPath,
  type AddPartyRoleRequest,
  type CreatePartyRequest,
  type LeadResponse,
  type LeadSummary,
  type PartyKind,
  type PartyListResponse,
  type PartyResponse,
  type PartySummary,
  type QualifyLeadRequest,
} from '@erp/shared';
import { Field, FormError } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { navigate } from '../../../app/location';

/**
 * Converting a qualified lead into a real contact, in one click.
 *
 * The three calls this composes are deliberately three calls: create-or-find the `Party`
 * through Parties' own endpoints, ask `crm` to qualify the Lead against the resulting id, then
 * tag that Party `prospect` through Parties' own roles endpoint. `crm`'s backend writes neither
 * a `Party` nor a `PartyRole` — "one click" is a property of this button, not a reason to
 * collapse a module boundary.
 *
 * The duplicate check is what makes linking the default path rather than the careful one. A
 * lead whose organisation or email already exists in the address book is the common case, and
 * converting without looking is how an address book ends up with the same customer three times.
 */
export function ConvertLeadModal({
  lead,
  onClose,
  onConverted,
}: {
  lead: LeadSummary;
  onClose: () => void;
  onConverted: () => void;
}) {
  const [chosenPartyId, setChosenPartyId] = useState<string>();
  const [kind, setKind] = useState<PartyKind>(lead.organisationName ? 'organisation' : 'person');
  const [name, setName] = useState(lead.organisationName || lead.name);
  const [email, setEmail] = useState(lead.email ?? '');
  const [phone, setPhone] = useState(lead.phone ?? '');

  const matches = useDuplicateCheck(lead);

  const convert = useMutation({
    mutationFn: async (): Promise<LeadResponse> => {
      const partyId = chosenPartyId ?? (await createParty()).id;

      const qualified = await api.post<LeadResponse>(LEAD_PATHS.qualify(lead.id), {
        action: chosenPartyId ? 'link' : 'create',
        partyId,
      } satisfies QualifyLeadRequest);

      await api.post<PartyResponse>(PARTY_PATHS.partyRoles(partyId), {
        role: PROSPECT_ROLE,
      } satisfies AddPartyRoleRequest);

      // The whole point of the button is that the next step — creating a Deal — is right there.
      navigate(`/parties?partyId=${partyId}`);
      return qualified;
    },
    onSuccess: onConverted,
  });

  function createParty(): Promise<PartyResponse> {
    return api.post<PartyResponse>(PARTY_PATHS.parties, {
      kind,
      name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
    } satisfies CreatePartyRequest);
  }

  const failure = convert.error instanceof ApiFailure ? convert.error : undefined;
  const fields = failure?.fields ?? {};
  const creating = chosenPartyId === undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <section
        aria-labelledby="convert-lead-heading"
        className="flex w-full max-w-md flex-col gap-5 rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h3 id="convert-lead-heading" className="text-base font-bold text-slate-900">
            Move {lead.name} to Contacts
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {matches.isLoading ? (
          <p role="status" className="text-xs text-slate-500">
            Checking for an existing contact…
          </p>
        ) : (
          matches.parties.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-xs font-semibold text-slate-700">
                {matches.parties.length === 1
                  ? 'This contact already exists — link it instead of creating a duplicate.'
                  : 'These contacts already exist — link one instead of creating a duplicate.'}
              </legend>
              {matches.parties.map((party) => (
                <label key={party.id} className="flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="convert-target"
                    checked={chosenPartyId === party.id}
                    onChange={() => setChosenPartyId(party.id)}
                  />
                  <span>
                    {party.name}
                    {party.email && <span className="text-slate-500"> · {party.email}</span>}
                  </span>
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="convert-target"
                  checked={creating}
                  onChange={() => setChosenPartyId(undefined)}
                />
                <span>Create a new contact instead</span>
              </label>
            </fieldset>
          )
        )}

        {creating && (
          <div className="flex flex-col gap-3">
            <fieldset className="flex gap-4">
              <legend className="sr-only">Is this a person or an organisation</legend>
              {(['person', 'organisation'] as const).map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm text-slate-900">
                  <input
                    type="radio"
                    name="convert-party-kind"
                    checked={kind === option}
                    onChange={() => setKind(option)}
                  />
                  {option === 'person' ? 'Person' : 'Organisation'}
                </label>
              ))}
            </fieldset>
            <Field
              id="convert-name"
              label="Contact name"
              value={name}
              error={fields.name}
              onChange={setName}
            />
            <Field
              id="convert-email"
              label="Email"
              type="email"
              value={email}
              error={fields.email}
              onChange={setEmail}
            />
            <Field
              id="convert-phone"
              label="Phone"
              value={phone}
              error={fields.phone}
              onChange={setPhone}
            />
          </div>
        )}

        {failure && failure.code !== ERROR_CODES.validationFailed && (
          <FormError>{failure.message}</FormError>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={convert.isPending || (creating && !name.trim())}
            onClick={() => convert.mutate()}
            className="rounded bg-[#1b8754] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#156d43] disabled:opacity-50"
          >
            {convert.isPending ? 'Converting…' : 'Convert to contact'}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * `prospect` — what the address book records this party is to us, without claiming they are
 * already a customer. Parties keeps roles an open set on purpose, so the word is defined by the
 * module that means it.
 */
const PROSPECT_ROLE = 'prospect';

/**
 * Parties already in the address book that look like this lead.
 *
 * Two searches rather than one: an email match and an organisation-name match answer different
 * questions, and Parties' list search is a single term. Results are merged and deduplicated so
 * a party matching on both appears once.
 */
function useDuplicateCheck(lead: LeadSummary): { parties: PartySummary[]; isLoading: boolean } {
  const terms = [lead.email, lead.organisationName].filter(
    (term): term is string => typeof term === 'string' && term.trim().length > 0,
  );

  const query = useQuery({
    queryKey: ['crm', 'convert', 'duplicates', ...terms],
    enabled: terms.length > 0,
    queryFn: async () => {
      const found = await Promise.all(
        terms.map((term) =>
          api.get<PartyListResponse>(listPath(PARTY_PATHS.parties, { search: term, pageSize: 5 })),
        ),
      );

      const seen = new Map<string, PartySummary>();
      for (const response of found) {
        for (const party of response.items) seen.set(party.id, party);
      }
      return [...seen.values()];
    },
  });

  return { parties: query.data ?? [], isLoading: terms.length > 0 && query.isLoading };
}
