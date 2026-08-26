import { useEffect, useState } from 'react';
import type { LeadStatusKey } from '@erp/shared';
import { Button, Modal } from '@erp/shared/ui';
import { useLeadStatusLabels } from '../vocabulary';
import { StatusEditor, StatusRow, nextColour, useStatusVocabularyWrites } from './StatusPicker';

/**
 * The whole status vocabulary in one dialog: rename, recolour, add, remove.
 *
 * The same work is reachable from the picker in any lead's status cell, which is where most of
 * it will actually happen — a stage gets invented at the moment somebody needs to file a lead
 * into it. This exists for the other case: sitting down to lay out the board before any leads
 * are on it, where opening a row's picker to design the pipeline would be a strange way in.
 *
 * Both surfaces are the same rows and the same three writes, from `StatusPicker` — a second
 * implementation would be a second set of rules about what may be deleted.
 */
export function StatusLabelsModal({ onClose }: { onClose: () => void }) {
  const vocabulary = useLeadStatusLabels();
  const { save, add, remove, failure, clearFailure } = useStatusVocabularyWrites();

  const [editing, setEditing] = useState<LeadStatusKey>();
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (add.isSuccess) setIsAdding(false);
  }, [add.isSuccess]);

  return (
    <Modal
      onClose={onClose}
      icon="🏷"
      title="Statuses"
      description="The stages a lead moves through on this board. Rename them, recolour them, or add stages of your own."
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="flex flex-col gap-2">
        <div className="-mx-2 flex flex-col">
          {vocabulary.list.map((item) =>
            editing === item.status ? (
              <StatusEditor
                key={item.status}
                item={item}
                busy={save.isPending || remove.isPending}
                onSave={(change) => {
                  save.mutate({ status: item.status, ...change });
                  setEditing(undefined);
                }}
                onDelete={item.isCustom ? () => remove.mutate(item.status) : undefined}
                onCancel={() => setEditing(undefined)}
              />
            ) : (
              <StatusRow
                key={item.status}
                item={item}
                isCurrent={false}
                // Nothing is being filed here, so a row is not a choice — the pencil is the
                // only action, and clicking the row itself opens the same editor rather than
                // doing nothing.
                onPick={() => {
                  clearFailure();
                  setEditing(item.status);
                }}
                onEdit={() => {
                  clearFailure();
                  setEditing(item.status);
                }}
              />
            ),
          )}
        </div>

        {failure && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {failure}
          </p>
        )}

        {isAdding ? (
          <StatusEditor
            item={{
              status: '',
              label: '',
              color: nextColour(vocabulary.list.length),
              isCustom: true,
              order: 0,
              isSettable: true,
            }}
            busy={add.isPending}
            onSave={(change) => add.mutate({ label: change.label ?? '', color: change.color ?? '#64748b' })}
            onCancel={() => setIsAdding(false)}
          />
        ) : (
          <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-3">
            <p className="text-[11px] text-slate-500">
              Qualified and Disqualified are set by moving a lead to Contacts or disqualifying it,
              so they cannot be picked directly — but they can be renamed and recoloured.
            </p>
            <Button
              variant="primary"
              onClick={() => {
                clearFailure();
                setIsAdding(true);
              }}
            >
              <span aria-hidden="true">+</span> Add status
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
