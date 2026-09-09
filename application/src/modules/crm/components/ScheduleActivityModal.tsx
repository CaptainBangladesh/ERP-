import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  LEAD_PATHS,
  listPath,
  type ActivityResponse,
  type CreateActivityRequest,
  type LeadListResponse,
  type LeadResponse,
  type UserSummary,
} from '@erp/shared';
import { api, ApiFailure } from '../../../api/client';

export type ActivityKind = 'task' | 'meeting' | 'call' | 'note';

export interface ScheduleActivityModalProps {
  initialDate?: string; // YYYY-MM-DD
  initialTime?: string; // HH:mm
  users: UserSummary[];
  currentUserId?: string;
  canManageTeam?: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

function getCurrentTimeString(offsetMinutes = 0): string {
  const d = new Date(Date.now() + offsetMinutes * 60 * 1000);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function ScheduleActivityModal({
  initialDate,
  initialTime,
  users,
  currentUserId,
  canManageTeam = false,
  onClose,
  onSuccess,
}: ScheduleActivityModalProps) {
  const queryClient = useQueryClient();

  const todayIso = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<ActivityKind>('task');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState(initialDate || todayIso);
  const [dueTime, setDueTime] = useState(initialTime || (() => getCurrentTimeString(0)));
  const [assignedToUserId, setAssignedToUserId] = useState(currentUserId || users[0]?.id || '');
  const [leadMode, setLeadMode] = useState<'existing' | 'new'>('existing');
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [newLeadName, setNewLeadName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const leadsQuery = useQuery({
    queryKey: ['crm', 'leads', 'for-scheduling'],
    queryFn: () => api.get<LeadListResponse>(listPath(LEAD_PATHS.leads, { pageSize: 100 })),
  });

  const leads = leadsQuery.data?.items ?? [];

  useEffect(() => {
    if (leads.length > 0 && !selectedLeadId) {
      setSelectedLeadId(leads[0]!.id);
      setLeadMode('existing');
    } else if (!leadsQuery.isLoading && leads.length === 0) {
      setLeadMode('new');
    }
  }, [leads, leadsQuery.isLoading, selectedLeadId]);

  useEffect(() => {
    if (initialDate) {
      setDueDate(initialDate);
    }
  }, [initialDate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedNotes = notes.trim();
    if (!trimmedNotes) {
      setError('Please provide task notes or a description.');
      return;
    }

    if (!dueDate) {
      setError('Please select a due date.');
      return;
    }

    setBusy(true);

    try {
      let leadId = selectedLeadId;

      if (leadMode === 'new') {
        const trimmedLeadName = newLeadName.trim();
        if (!trimmedLeadName) {
          setError('Please provide a name for the associated lead or account.');
          setBusy(false);
          return;
        }

        const createdLead = await api.post<LeadResponse>(LEAD_PATHS.leads, {
          name: trimmedLeadName,
        });
        leadId = createdLead.id;
      }

      if (!leadId) {
        setError('Please select or create a lead for this task.');
        setBusy(false);
        return;
      }

      let prefix = '';
      if (kind === 'meeting') prefix = '🤝 [Meeting] ';
      else if (kind === 'call') prefix = '📞 [Call] ';
      else if (kind === 'note') prefix = '📝 [Note] ';

      const finalNotes = `${prefix}${trimmedNotes}`;
      const dueDateTime = new Date(`${dueDate}T${dueTime || '12:00'}:00`);
      const dueAtIso = isNaN(dueDateTime.getTime()) ? new Date().toISOString() : dueDateTime.toISOString();

      const requestedAssignee = canManageTeam ? (assignedToUserId || currentUserId) : currentUserId;

      await api.post<ActivityResponse>(ACTIVITY_PATHS.activities, {
        type: 'task',
        notes: finalNotes,
        dueAt: dueAtIso,
        assignedToUserId: requestedAssignee || undefined,
        leadId,
      } satisfies CreateActivityRequest);

      // Invalidate relevant queries so all calendar and planning views update immediately
      void queryClient.invalidateQueries({ queryKey: ['crm', 'planning'] });
      void queryClient.invalidateQueries({ queryKey: ['crm', 'planner'] });
      void queryClient.invalidateQueries({ queryKey: ['crm', 'activities'] });
      void queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });

      onSuccess?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiFailure) {
        const fieldErrors = Object.values(err.fields);
        setError(fieldErrors.length > 0 ? fieldErrors.join(' ') : err.message);
      } else {
        setError('An unexpected error occurred while scheduling the task.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
    >
      <div className="flex w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 id="schedule-modal-title" className="text-lg font-bold text-slate-900">
            Schedule Task or Event
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {error}
            </div>
          )}

          {/* Kind Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600">Type</label>
            <div className="grid grid-cols-4 gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1">
              {(
                [
                  { id: 'task', label: '⚡ Task' },
                  { id: 'meeting', label: '🤝 Meeting' },
                  { id: 'call', label: '📞 Call' },
                  { id: 'note', label: '📝 Note' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setKind(item.id)}
                  className={`rounded-md py-1.5 text-xs font-semibold transition ${
                    kind === item.id
                      ? 'bg-white text-slate-900 shadow-2xs font-bold'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes / Description */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="task-notes" className="text-xs font-semibold text-slate-600">
              {kind === 'meeting'
                ? 'Meeting Agenda / Topic'
                : kind === 'call'
                  ? 'Call Objective'
                  : kind === 'note'
                    ? 'Planning Note / Reminder'
                    : 'Task Details'}
              <span className="text-rose-500 ml-0.5">*</span>
            </label>
            <textarea
              id="task-notes"
              rows={3}
              required
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                kind === 'meeting'
                  ? 'e.g. Q3 Pipeline Review with Sunita Kapoor'
                  : kind === 'call'
                    ? 'e.g. Follow up on custom pricing question'
                    : kind === 'note'
                      ? 'e.g. Prepare monthly quota projection by Thursday'
                      : 'e.g. Send updated pricing proposal and draft contract'
              }
              className="rounded-lg border border-slate-200 p-2.5 text-xs text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="task-date" className="text-xs font-semibold text-slate-600">
                Date<span className="text-rose-500 ml-0.5">*</span>
              </label>
              <input
                id="task-date"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="task-time" className="text-xs font-semibold text-slate-600">
                Time
              </label>
              <input
                id="task-time"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                <button
                  type="button"
                  onClick={() => setDueTime(getCurrentTimeString(0))}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 transition"
                >
                  Now
                </button>
                <button
                  type="button"
                  onClick={() => setDueTime(getCurrentTimeString(60))}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 transition"
                >
                  +1 hr
                </button>
                <button
                  type="button"
                  onClick={() => setDueTime('09:00')}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 transition"
                >
                  9 AM
                </button>
                <button
                  type="button"
                  onClick={() => setDueTime('14:00')}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 transition"
                >
                  2 PM
                </button>
                <button
                  type="button"
                  onClick={() => setDueTime('17:00')}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 transition"
                >
                  5 PM
                </button>
              </div>
            </div>
          </div>

          {/* Assignee */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="task-assignee" className="text-xs font-semibold text-slate-600">
              Assignee
            </label>
            <select
              id="task-assignee"
              value={assignedToUserId}
              disabled={!canManageTeam && users.length > 1}
              onChange={(e) => setAssignedToUserId(e.target.value)}
              className="rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50 disabled:text-slate-500"
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} {user.id === currentUserId ? '(You)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Lead / Account Association */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-600">
                Related Lead / Account<span className="text-rose-500 ml-0.5">*</span>
              </label>
              {leads.length > 0 && (
                <button
                  type="button"
                  onClick={() => setLeadMode(leadMode === 'existing' ? 'new' : 'existing')}
                  className="text-[11px] font-semibold text-teal-600 hover:text-teal-700"
                >
                  {leadMode === 'existing' ? '+ New Lead' : 'Choose existing lead'}
                </button>
              )}
            </div>

            {leadMode === 'existing' && leads.length > 0 ? (
              <select
                value={selectedLeadId}
                onChange={(e) => setSelectedLeadId(e.target.value)}
                className="rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              >
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.organisationName ? `(${l.organisationName})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={newLeadName}
                onChange={(e) => setNewLeadName(e.target.value)}
                placeholder="e.g. Northwind Trading, or Internal Planning"
                className="rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            )}
          </div>

          {/* Modal Actions */}
          <div className="mt-2 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-teal-700 disabled:opacity-50"
            >
              {busy ? 'Scheduling…' : 'Schedule Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
