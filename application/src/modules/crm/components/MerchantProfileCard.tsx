import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  type ActivityResponse,
  type CreateActivityRequest,
  type LeadFieldSummary,
  type LeadResponse,
  type LeadSubmissionSummary,
} from '@erp/shared';
import { api } from '../../../api/client';
import { firstUrlIn, hrefFor, prettyUrl } from '../survey-answers';
import type { MerchantProfile, SocialPresence, UsabilityAnswer } from '../merchant-intel';
import { AnswerValue } from './AnswerValue';
import { CheckIcon, ExternalLinkIcon, LinkIcon, NoteIcon, PencilIcon } from '../icons';
import { EditMerchantProfileModal } from './EditMerchantProfileModal';

// ─── shared bits ────────────────────────────────────────────────────────────────────────

/** A yes / no / not-applicable answer, coloured so the answer reads before the word does. */
function PresenceBadge({ value }: { value?: string }) {
  if (!value) return <span className="text-xs font-semibold text-slate-400">—</span>;
  const normalised = value.trim().toLowerCase();
  const tone =
    normalised === 'yes' || normalised === 'true'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : normalised === 'no' || normalised === 'false' || normalised === 'none'
      ? 'border-slate-200 bg-slate-100 text-slate-500'
      : 'border-amber-200 bg-amber-50 text-amber-700';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone}`}>
      {value}
    </span>
  );
}

/** A clickable link shown by its destination, protocol and tracking stripped. */
function LinkChip({ url }: { url: string }) {
  // `url` may arrive with junk beside it (a trailing newline, a stray word); pull out the token so
  // the href is clean and the visible text is the short destination, never the raw 300-char paste.
  const clean = firstUrlIn(url) ?? url;
  return (
    <a
      href={hrefFor(clean)}
      target="_blank"
      rel="noopener noreferrer"
      title={clean}
      className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700 transition hover:border-teal-300 hover:bg-teal-100"
    >
      <span className="min-w-0 truncate">{prettyUrl(clean)}</span>
      <span aria-hidden="true" className="shrink-0">
        <ExternalLinkIcon size={11} />
      </span>
    </a>
  );
}

function SocialPill({ social }: { social: SocialPresence }) {
  const detail = social.followers ? ` · ${social.followers}` : '';
  if (social.url) {
    return (
      <a
        href={hrefFor(social.url)}
        target="_blank"
        rel="noopener noreferrer"
        title={social.url}
        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-700 transition hover:border-teal-300 hover:text-teal-700"
      >
        {social.platform}
        {detail}
        <span aria-hidden="true" className="text-slate-400">
          <ExternalLinkIcon size={10} />
        </span>
      </a>
    );
  }
  const handleText = social.present
    ? social.present
    : social.handle
    ? firstUrlIn(social.handle)
      ? prettyUrl(social.handle)
      : social.handle
    : '';
  return (
    <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
      {social.platform}
      {handleText ? ` · ${handleText}` : ''}
      {social.followers ? ` · ${social.followers}` : ''}
    </span>
  );
}

// ─── the workspace rail snapshot ────────────────────────────────────────────────────────

/**
 * The compact merchant read for the right-hand rail: category, whether they have a site and an
 * app, their socials as one clickable set, and the top few remaining facts. The long stuff — the
 * usability grid, the free-text notes — is left for the Survey tab, which has the width for it.
 */
export function MerchantSnapshot({ profile }: { profile: MerchantProfile }) {
  const hasWebsite = Boolean(profile.website.present || profile.website.url);

  return (
    <>
      {profile.category && (
        <RailLine label="Category">
          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
            {profile.category}
          </span>
        </RailLine>
      )}

      {hasWebsite && (
        <RailLine label="Website">
          <div className="flex min-w-0 flex-col items-end gap-1">
            {profile.website.present && <PresenceBadge value={profile.website.present} />}
            {profile.website.url && <LinkChip url={profile.website.url} />}
          </div>
        </RailLine>
      )}

      {profile.app.present && (
        <RailLine label="Mobile app">
          <PresenceBadge value={profile.app.present} />
        </RailLine>
      )}

      {profile.socials.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Online presence</span>
          <div className="flex flex-wrap gap-1.5">
            {profile.socials.map((social) => (
              <SocialPill key={social.platform} social={social} />
            ))}
          </div>
        </div>
      )}

      {profile.facts.slice(0, 5).map((fact) => (
        <div key={fact.label} className="flex flex-col gap-0.5 border-t border-slate-100 pt-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{fact.label}</span>
          <div className="min-w-0 text-xs font-semibold text-slate-800">
            <AnswerValue value={fact.raw} />
          </div>
        </div>
      ))}
    </>
  );
}

function RailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}

// ─── the Survey-tab profile card ────────────────────────────────────────────────────────

/**
 * The full merchant read for the Survey tab: everything the snapshot shows, plus the usability
 * review laid out question-by-answer and the free-text notes given their own home with a one-tap
 * way to file each onto the lead's activity feed.
 */
export function MerchantProfileCard({
  profile,
  lead,
  leadId,
  canWrite,
  submissions,
  customFieldDefinitions,
  onProfileUpdated,
}: {
  profile: MerchantProfile;
  lead?: LeadResponse;
  leadId: string;
  canWrite: boolean;
  submissions?: LeadSubmissionSummary[];
  customFieldDefinitions?: LeadFieldSummary[];
  onProfileUpdated?: () => void;
}) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const queryClient = useQueryClient();

  function handleProfileUpdated() {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'leads', 'submissions', leadId] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'leads', 'detail', leadId] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });
    onProfileUpdated?.();
  }

  const overview: { label: string; node: React.ReactNode }[] = [];
  if (profile.category) {
    overview.push({
      label: 'Merchant category',
      node: <span className="text-sm font-semibold text-slate-800">{profile.category}</span>,
    });
  }
  if (profile.website.present || profile.website.url) {
    overview.push({
      label: 'Dedicated website',
      node: (
        <div className="flex flex-wrap items-center gap-2">
          {profile.website.present && <PresenceBadge value={profile.website.present} />}
          {profile.website.url && <LinkChip url={profile.website.url} />}
        </div>
      ),
    });
  }
  if (profile.app.present) {
    overview.push({ label: 'Mobile application', node: <PresenceBadge value={profile.app.present} /> });
  }
  for (const fact of profile.facts) {
    overview.push({
      label: fact.label,
      node: (
        <div className="text-sm font-semibold text-slate-800">
          <AnswerValue value={fact.raw} />
        </div>
      ),
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-bold text-slate-900">Merchant profile</h3>
          <p className="text-xs text-slate-500">What the research says about this lead, at a glance.</p>
        </div>

        {canWrite && (
          <button
            type="button"
            onClick={() => setIsEditModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
          >
            <PencilIcon size={13} />
            Edit profile
          </button>
        )}
      </div>

      {overview.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {overview.map((row) => (
            <div key={row.label} className="flex min-w-0 flex-col gap-1">
              <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{row.label}</dt>
              <dd className="min-w-0">{row.node}</dd>
            </div>
          ))}
        </dl>
      )}

      {profile.socials.length > 0 && (
        <Section title="Online presence">
          <div className="flex flex-col gap-2">
            {profile.socials.map((social) => (
              <SocialRow key={social.platform} social={social} />
            ))}
          </div>
        </Section>
      )}

      {profile.usability.length > 0 && (
        <Section title="Website usability review">
          <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200">
            {profile.usability.map((entry, index) => (
              <UsabilityRow key={`${entry.question}-${index}`} entry={entry} />
            ))}
          </ul>
        </Section>
      )}

      {profile.notes.length > 0 && (
        <Section title="Research notes">
          <div className="flex flex-col gap-2">
            {profile.notes.map((note, index) => (
              <NoteRow key={`${note.label}-${index}`} note={note} leadId={leadId} canWrite={canWrite} />
            ))}
          </div>
        </Section>
      )}

      {isEditModalOpen && (
        <EditMerchantProfileModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSuccess={handleProfileUpdated}
          lead={lead ?? ({ id: leadId, name: 'Lead' } as LeadResponse)}
          profile={profile}
          submissions={submissions}
          customFieldDefinitions={customFieldDefinitions}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</h4>
      {children}
    </section>
  );
}

function SocialRow({ social }: { social: SocialPresence }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-slate-400">
          <LinkIcon size={14} />
        </span>
        <span className="text-xs font-bold text-slate-800">{social.platform}</span>
        {social.present && <PresenceBadge value={social.present} />}
        {social.followers && (
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600">
            {social.followers} followers
          </span>
        )}
      </div>
      {social.url ? (
        <LinkChip url={social.url} />
      ) : social.handle && firstUrlIn(social.handle) ? (
        <LinkChip url={social.handle} />
      ) : social.handle ? (
        <span className="min-w-0 max-w-full truncate text-xs text-slate-500">{social.handle}</span>
      ) : null}
    </div>
  );
}

function UsabilityRow({ entry }: { entry: UsabilityAnswer }) {
  const isYesNo = /^(yes|no|n\/?a|not applicable)$/i.test(entry.answer.trim());
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <span className="min-w-0 text-xs font-semibold text-slate-700">{entry.question}</span>
      {isYesNo ? (
        <PresenceBadge value={entry.answer} />
      ) : (
        <span className="text-xs font-semibold text-slate-800">{entry.answer}</span>
      )}
    </li>
  );
}

function NoteRow({
  note,
  leadId,
  canWrite,
}: {
  note: { label: string; text: string };
  leadId: string;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const [added, setAdded] = useState(false);

  const addToNotes = useMutation({
    mutationFn: () =>
      api.post<ActivityResponse>(ACTIVITY_PATHS.activities, {
        type: 'note',
        notes: note.text,
        leadId,
      } satisfies CreateActivityRequest),
    onSuccess: () => {
      setAdded(true);
      void queryClient.invalidateQueries({ queryKey: ['crm', 'activities', 'lead', leadId] });
    },
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-amber-50/40 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-amber-500">
          <NoteIcon size={14} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{note.label}</span>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{note.text}</p>
        </div>
      </div>
      {canWrite && (
        <div className="flex justify-end">
          {added ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
              <CheckIcon size={12} />
              Added to notes
            </span>
          ) : (
            <button
              type="button"
              disabled={addToNotes.isPending}
              onClick={() => addToNotes.mutate()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <NoteIcon size={12} />
              Add to notes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
