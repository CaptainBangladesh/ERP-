import {
  describeAudit,
  describeSentEmail,
  type ActivityFeedItem,
  type AuditEvent,
} from '@erp/shared';
import { linkProps } from '../../../app/location';
import { leadWorkspacePath } from '../pages/LeadWorkspace';
import { avatarColour, initialsOf } from '../survey-answers';
import {
  CalendarIcon,
  ChecklistIcon,
  ClockIcon,
  EyeIcon,
  MailIcon,
  NoteIcon,
  PaperclipIcon,
  PhoneIcon,
} from '../icons';

/**
 * The company feed's rows — the same timeline the Lead Workspace draws, widened to say *whose*
 * record each entry belongs to and *who* logged it.
 *
 * It reuses the workspace's own reading of the wire — `describeAudit` and `describeSentEmail` —
 * so a status change, an email open and a hand-typed note read here exactly as they do on the
 * lead, and a format this version has not met still falls back to its text rather than breaking
 * the feed. What it adds is the two facts a per-lead history never needs: a link to the parent
 * record, and a "You" mark on the rows that are the reader's own, which is what lets one feed be
 * both "my activity" and "the team's" without the server having to render two.
 */

function presentation(
  item: ActivityFeedItem,
  audit: AuditEvent | undefined,
): { icon: React.ReactNode; ring: string; tag: string } {
  if (audit) {
    switch (audit.kind) {
      case 'email-opened':
        return { icon: <EyeIcon size={14} />, ring: 'bg-teal-50 text-teal-700', tag: 'Email opened' };
      case 'file-attached':
        return { icon: <PaperclipIcon size={14} />, ring: 'bg-slate-100 text-slate-600', tag: 'File' };
      case 'survey-received':
        return { icon: <ChecklistIcon size={14} />, ring: 'bg-violet-50 text-violet-700', tag: 'Survey' };
      default:
        return { icon: <ClockIcon size={14} />, ring: 'bg-slate-100 text-slate-500', tag: 'Update' };
    }
  }

  switch (item.type) {
    case 'email':
      return { icon: <MailIcon size={14} />, ring: 'bg-blue-50 text-blue-700', tag: 'Email' };
    case 'call':
      return { icon: <PhoneIcon size={14} />, ring: 'bg-indigo-50 text-indigo-700', tag: 'Call' };
    case 'meeting':
      return { icon: <CalendarIcon size={14} />, ring: 'bg-purple-50 text-purple-700', tag: 'Meeting' };
    case 'task':
      return { icon: <ChecklistIcon size={14} />, ring: 'bg-emerald-50 text-emerald-700', tag: 'Task' };
    default:
      return { icon: <NoteIcon size={14} />, ring: 'bg-amber-50 text-amber-700', tag: 'Note' };
  }
}

/** A short headline for the entry, mirroring the workspace feed's wording. */
function headlineOf(item: ActivityFeedItem, audit: AuditEvent | undefined): string {
  const who = item.parentName ?? 'a removed record';
  if (audit?.kind === 'email-opened') return `${who} likely opened “${audit.subject}”`;
  if (audit?.kind === 'status-changed') return `Status changed from ${audit.from} to ${audit.to}`;
  if (audit?.kind === 'file-attached') return `Attached ${audit.filename}`;
  if (audit?.kind === 'survey-received') return `Answered ${audit.formName}`;
  if (audit?.kind === 'lead-assigned') return 'Lead assigned';
  const sent = !audit && item.type === 'email' ? describeSentEmail(item.notes) : undefined;
  if (sent) return `Sent “${sent.subject}”`;
  return '';
}

/** The plain text body, or empty when the headline already carries the whole entry. */
function bodyOf(item: ActivityFeedItem, audit: AuditEvent | undefined): string {
  if (audit && audit.kind !== 'other') return '';
  if (!audit && item.type === 'email' && describeSentEmail(item.notes)) {
    return describeSentEmail(item.notes)!.preview;
  }
  return audit?.kind === 'other' ? audit.text : item.notes;
}

const PARENT_LABEL: Record<NonNullable<ActivityFeedItem['parentKind']>, string> = {
  lead: 'Lead',
  deal: 'Deal',
  party: 'Contact',
};

function ParentTag({ item }: { item: ActivityFeedItem }) {
  if (!item.parentKind || !item.parentName) {
    return <span className="text-[11px] font-semibold text-slate-400">a removed record</span>;
  }

  const kind = PARENT_LABEL[item.parentKind];
  const label = (
    <>
      <span className="text-slate-400">{kind}</span> <span className="text-slate-800">{item.parentName}</span>
    </>
  );

  // Only a lead has a page to land on; deals and contacts have boards, not per-record screens,
  // so linking them would drop somebody on a list with no way back to the row they clicked.
  if (item.parentKind === 'lead' && item.leadId) {
    return (
      <a
        {...linkProps(leadWorkspacePath(item.leadId))}
        className="text-[11px] font-semibold text-teal-700 transition hover:text-teal-900 hover:underline"
      >
        <span className="text-teal-500/70">{kind}</span> {item.parentName}
      </a>
    );
  }
  return <span className="text-[11px] font-semibold">{label}</span>;
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white ${avatarColour(name)}`}
    >
      {initialsOf(name)}
    </span>
  );
}

export function ActivityFeedList({
  items,
  currentUserId,
  emptyLabel = 'Nothing has happened yet.',
}: {
  items: ActivityFeedItem[];
  currentUserId: string | undefined;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center text-xs text-slate-500">
        {emptyLabel}
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {items.map((item, index) => {
        const audit = describeAudit(item.notes);
        const { icon, ring, tag } = presentation(item, audit);
        const headline = headlineOf(item, audit);
        const body = bodyOf(item, audit);
        const mine = Boolean(currentUserId) && item.createdByUserId === currentUserId;
        const isLast = index === items.length - 1;
        const when = new Date(item.occurredAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        });

        return (
          <li key={item.id} className="flex gap-3">
            <div className="flex shrink-0 flex-col items-center">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full ${ring}`}>{icon}</span>
              {!isLast && <span aria-hidden="true" className="w-px flex-1 bg-slate-200" />}
            </div>

            <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-3'}`}>
              <div className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{tag}</span>
                    <ParentTag item={item} />
                  </div>
                  <span className="shrink-0 text-[11px] font-medium text-slate-400">{when}</span>
                </div>

                {headline && <p className="text-xs font-bold text-slate-900">{headline}</p>}

                {body && (
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700 line-clamp-4">{body}</p>
                )}

                {!audit && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <Avatar name={item.createdByName} />
                    <span className="text-[11px] text-slate-500">
                      by <span className="font-semibold text-slate-600">{item.createdByName}</span>
                    </span>
                    {mine && (
                      <span className="rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-700 ring-1 ring-teal-200">
                        You
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
