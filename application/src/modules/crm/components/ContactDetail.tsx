import { useMutation, useQuery } from '@tanstack/react-query';
import {
  DEAL_FIELDS,
  DEAL_PATHS,
  PARTY_PATHS,
  listPath,
  type DealListResponse,
  type PartyResponse,
} from '@erp/shared';
import { formatMoney } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { ActivityTimeline } from './ActivityTimeline';

/**
 * One contact, opened.
 *
 * Three things about a person that the board can only summarise: who they are and how to
 * reach them, what is in flight with them, and everything that has been said to them. The
 * last two come from crm's own tables keyed on `partyId` — this panel is where a party record
 * and the CRM's memory of dealing with them are shown as one thing, which is the whole reason
 * the Contacts board is a CRM screen rather than a second address book.
 *
 * The account picker is here rather than on the board because the board is *grouped* by
 * account: a row already sits under the company it belongs to, so a per-row copy of the same
 * fact would be noise. Moving somebody between companies is a deliberate act, and this is
 * where a deliberate act belongs.
 */
export function ContactDetail({
  contactId,
  accounts,
  onClose,
  onChanged,
}: {
  contactId: string;
  accounts: { id: string; name: string }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { session } = useSession();
  const canWrite = hasPermission(session, 'parties:parties:write');
  const canReadDeals = hasPermission(session, 'crm:deals:read');

  const contactQuery = useQuery({
    queryKey: ['parties', 'party', contactId],
    queryFn: () => api.get<PartyResponse>(PARTY_PATHS.party(contactId)),
  });

  const dealsQuery = useQuery({
    queryKey: ['crm', 'deals', 'of-party', contactId],
    queryFn: () =>
      api.get<DealListResponse>(
        listPath(DEAL_PATHS.deals, { filters: { [DEAL_FIELDS.partyId]: contactId }, pageSize: 50 }),
      ),
    enabled: canReadDeals,
  });

  const contact = contactQuery.data;
  const deals = dealsQuery.data?.items ?? [];

  /**
   * A mutation rather than a bare `await`, so a refusal has somewhere to land.
   *
   * This panel's one write is a select, and a select that silently does nothing is worse than
   * one that says why — the server can refuse it (a stale account id, a party merged away
   * under it), and without this the refusal was an unhandled rejection nobody saw.
   */
  const change = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.patch<PartyResponse>(PARTY_PATHS.party(contactId), data),
    onSuccess: async () => {
      await contactQuery.refetch();
      onChanged();
    },
  });

  const changeFailure = change.error instanceof ApiFailure ? change.error : undefined;
  const changeMessage = changeFailure
    ? changeFailure.fields.organisationId || changeFailure.message
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs">
      {/* The scrim closes the panel. A click outside a thing is the ordinary way to leave it. */}
      <button
        type="button"
        aria-label="Close contact"
        onClick={onClose}
        className="flex-1 cursor-default focus:outline-none"
      />

      <aside
        aria-label={contact?.name ?? 'Contact'}
        className="flex w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl"
      >
        {contactQuery.isPending ? (
          <p className="p-6 text-sm text-slate-500">Loading contact…</p>
        ) : !contact ? (
          <p className="p-6 text-sm text-rose-700">That contact could not be loaded.</p>
        ) : (
          <>
            <header className="flex items-start gap-3 border-b border-slate-200 p-5">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-bold text-slate-900">{contact.name}</h2>
                <p className="mt-0.5 truncate text-xs font-medium text-slate-500">
                  {contact.organisationName ?? 'No account'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100"
              >
                Close
              </button>
            </header>

            <section className="flex flex-col gap-3 border-b border-slate-200 p-5">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Details</h3>

              <Detail label="Email" value={contact.email} href={(v) => `mailto:${v}`} />
              <Detail label="Phone" value={contact.phone} href={(v) => `tel:${v}`} />
              <Detail
                label="Roles"
                value={contact.roles.length > 0 ? contact.roles.join(', ') : null}
              />

              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">Account</span>
                <select
                  aria-label={`Account of ${contact.name}`}
                  value={contact.organisationId ?? ''}
                  disabled={!canWrite || change.isPending}
                  // An empty string, not `null`: the platform reads a null as "do not touch
                  // it", and an emptied field is how `clearable` is told to write the column
                  // back to nothing. See `UpdatePartyBody`.
                  onChange={(event) => change.mutate({ organisationId: event.target.value })}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-teal-500 focus:outline-none disabled:cursor-default disabled:opacity-70"
                >
                  <option value="">No account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>

              {changeMessage && (
                <p role="alert" className="text-xs font-semibold text-rose-600">
                  {changeMessage}
                </p>
              )}
            </section>

            {canReadDeals && (
              <section className="flex flex-col gap-2 border-b border-slate-200 p-5">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Deals</h3>

                {deals.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Nothing in flight with this contact yet. A deal associated with them appears
                    here on its own.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {deals.map((deal) => (
                      <li
                        key={deal.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
                      >
                        <span className="min-w-0 truncate text-xs font-semibold text-slate-800">
                          {deal.name}
                        </span>
                        <span className="shrink-0 text-xs font-bold tabular-nums text-slate-700">
                          {formatMoney(deal.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section className="p-5">
              <ActivityTimeline parentKind="party" parentId={contactId} />
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

/** One read-only fact, shown the same way whether or not it has a value. */
function Detail({
  label,
  value,
  href,
}: {
  label: string;
  value: string | null;
  href?: (value: string) => string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-16 shrink-0 text-xs font-semibold text-slate-500">{label}</span>
      {value === null || value === '' ? (
        <span className="text-xs text-slate-400">—</span>
      ) : href ? (
        <a
          href={href(value)}
          rel="noopener noreferrer"
          className="min-w-0 truncate text-xs font-medium text-sky-600 hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="min-w-0 truncate text-xs font-medium text-slate-800">{value}</span>
      )}
    </div>
  );
}
