import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LEAD_GROUP_PATHS,
  LEAD_SOURCE_PATHS,
  type CreateLeadGroupRequest,
  type CreateLeadSourceRequest,
  type LeadGroupResponse,
  type LeadGroupSummary,
  type LeadSourceResponse,
  type LeadSourceSummary,
  type UpdateLeadGroupRequest,
  type UpdateLeadSourceRequest,
} from '@erp/shared';
import { Field, FormError } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { LEAD_VOCABULARY_KEY, useLeadGroups, useLeadSources } from '../vocabulary';

/**
 * Managing the two lists that shape the board — its swimlanes and its channel vocabulary.
 *
 * Both are the same interaction (a named, ordered, deletable row) so they share one screen and,
 * below, one row component. What differs is only which endpoint it talks to and whether it
 * carries a colour, which is small enough to pass in and not worth two near-identical files.
 *
 * Deleting either is refused by the server while leads still point at it, and the refusal says
 * what to do instead — so this shows the message rather than trying to predict it.
 */
export function BoardSetupModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'groups' | 'sources'>('groups');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <section
        aria-labelledby="board-setup-heading"
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h3 id="board-setup-heading" className="text-base font-bold text-slate-900">
            Board setup
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

        <div role="tablist" className="flex gap-2 rounded-md bg-slate-100 p-1 text-xs font-medium">
          {(['groups', 'sources'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              onClick={() => setTab(option)}
              className={`flex-1 rounded py-1.5 transition ${
                tab === option ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {option === 'groups' ? 'Groups' : 'Sources'}
            </button>
          ))}
        </div>

        {tab === 'groups' ? <GroupsTab /> : <SourcesTab />}
      </section>
    </div>
  );
}

function GroupsTab() {
  const { groups, isLoading } = useLeadGroups();
  const invalidate = useVocabularyRefresh();

  return (
    <VocabularyList
      isLoading={isLoading}
      emptyTitle="No groups yet."
      emptyHint="Groups are the swimlanes on your board — by region, by campaign, by rep, however your team already thinks about its leads."
      addLabel="group"
      onAdd={(name) =>
        api.post<LeadGroupResponse>(LEAD_GROUP_PATHS.leadGroups, {
          name,
        } satisfies CreateLeadGroupRequest)
      }
      onAdded={invalidate}
      rows={groups.map((group) => ({
        key: group.id,
        name: group.name,
        color: group.color,
        count: group.leadCount,
        isFirst: group.order === 1,
        isLast: group.order === groups.length,
        rename: (name) => patchGroup(group, { name }),
        recolor: (color) => patchGroup(group, { color }),
        move: (delta) => patchGroup(group, { order: group.order + delta }),
        remove: () => api.delete<void>(LEAD_GROUP_PATHS.leadGroup(group.id)),
      }))}
      onChanged={invalidate}
    />
  );

  function patchGroup(group: LeadGroupSummary, body: UpdateLeadGroupRequest) {
    return api.patch<LeadGroupResponse>(LEAD_GROUP_PATHS.leadGroup(group.id), body);
  }
}

function SourcesTab() {
  const { sources, isLoading } = useLeadSources();
  const invalidate = useVocabularyRefresh();

  return (
    <VocabularyList
      isLoading={isLoading}
      emptyTitle="No sources yet."
      emptyHint="Name the channels your leads actually arrive through — 'trade show', 'partner referral' — in the words your team uses for them."
      addLabel="source"
      onAdd={(name) =>
        api.post<LeadSourceResponse>(LEAD_SOURCE_PATHS.leadSources, {
          name,
        } satisfies CreateLeadSourceRequest)
      }
      onAdded={invalidate}
      rows={sources.map((source) => ({
        key: source.id,
        name: source.name,
        count: source.leadCount,
        isFirst: source.order === 1,
        isLast: source.order === sources.length,
        rename: (name) => patchSource(source, { name }),
        move: (delta) => patchSource(source, { order: source.order + delta }),
        remove: () => api.delete<void>(LEAD_SOURCE_PATHS.leadSource(source.id)),
      }))}
      onChanged={invalidate}
    />
  );

  function patchSource(source: LeadSourceSummary, body: UpdateLeadSourceRequest) {
    return api.patch<LeadSourceResponse>(LEAD_SOURCE_PATHS.leadSource(source.id), body);
  }
}

interface VocabularyRow {
  key: string;
  name: string;
  color?: string;
  count: number;
  isFirst: boolean;
  isLast: boolean;
  rename: (name: string) => Promise<unknown>;
  recolor?: (color: string) => Promise<unknown>;
  move: (delta: number) => Promise<unknown>;
  remove: () => Promise<unknown>;
}

function VocabularyList({
  isLoading,
  rows,
  emptyTitle,
  emptyHint,
  addLabel,
  onAdd,
  onAdded,
  onChanged,
}: {
  isLoading: boolean;
  rows: VocabularyRow[];
  emptyTitle: string;
  emptyHint: string;
  addLabel: string;
  onAdd: (name: string) => Promise<unknown>;
  onAdded: () => void;
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState('');

  const add = useMutation({
    mutationFn: () => onAdd(newName.trim()),
    onSuccess: () => {
      setNewName('');
      onAdded();
    },
  });

  const addFailure = add.error instanceof ApiFailure ? add.error : undefined;

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <p role="status" className="text-sm text-slate-500">
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-6 text-center">
          <p className="text-sm font-medium text-slate-800">{emptyTitle}</p>
          <p className="mt-1 text-xs text-slate-500">{emptyHint}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200">
          {rows.map((row) => (
            <VocabularyRowItem key={row.key} row={row} onChanged={onChanged} />
          ))}
        </ul>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (newName.trim()) add.mutate();
        }}
      >
        <div className="flex-1">
          <Field
            id={`new-${addLabel}`}
            label={`New ${addLabel}`}
            value={newName}
            error={addFailure?.fields.name}
            onChange={setNewName}
          />
        </div>
        <button
          type="submit"
          disabled={!newName.trim() || add.isPending}
          className="rounded bg-teal-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}

function VocabularyRowItem({ row, onChanged }: { row: VocabularyRow; onChanged: () => void }) {
  const [name, setName] = useState(row.name);

  const act = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: onChanged,
  });

  const failure = act.error instanceof ApiFailure ? act.error : undefined;

  return (
    <li className="flex flex-col gap-1.5 px-3 py-2">
      <div className="flex items-center gap-2">
        {row.recolor && (
          <label>
            <span className="sr-only">{row.name} colour</span>
            <input
              type="color"
              value={row.color}
              onChange={(event) => act.mutate(() => row.recolor!(event.target.value))}
              className="h-7 w-7 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
            />
          </label>
        )}
        <input
          aria-label={`Name of ${row.name}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name.trim() && name !== row.name) act.mutate(() => row.rename(name.trim()));
          }}
          className="min-w-0 flex-1 rounded border border-transparent px-2 py-1 text-sm hover:border-slate-200 focus:border-teal-600 focus:outline-none"
        />
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
          {row.count} {row.count === 1 ? 'lead' : 'leads'}
        </span>
        <button
          type="button"
          aria-label={`Move ${row.name} up`}
          disabled={row.isFirst || act.isPending}
          onClick={() => act.mutate(() => row.move(-1))}
          className="rounded px-1.5 py-1 text-slate-500 transition hover:bg-slate-100 disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move ${row.name} down`}
          disabled={row.isLast || act.isPending}
          onClick={() => act.mutate(() => row.move(1))}
          className="rounded px-1.5 py-1 text-slate-500 transition hover:bg-slate-100 disabled:opacity-30"
        >
          ↓
        </button>
        <button
          type="button"
          aria-label={`Delete ${row.name}`}
          disabled={act.isPending}
          onClick={() => act.mutate(row.remove)}
          className="rounded px-1.5 py-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
        >
          ✕
        </button>
      </div>
      {failure && <FormError>{failure.message}</FormError>}
    </li>
  );
}

function useVocabularyRefresh(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: LEAD_VOCABULARY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });
  };
}
