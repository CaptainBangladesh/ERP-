import { useState } from 'react';
import {
  CAPTURE_SOURCE_PATHS,
  type CaptureSourceSummary,
  type CaptureSubmitResponse,
  type LeadResponse,
} from '@erp/shared';
import { Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';

interface ManualSurveyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  lead: LeadResponse;
  sources: CaptureSourceSummary[];
}

export function ManualSurveyModal({
  isOpen,
  onClose,
  onSuccess,
  lead,
  sources,
}: ManualSurveyModalProps) {
  const activeSources = sources.filter((s) => s.enabled);
  const [formName, setFormName] = useState('Google Form Response');
  const [selectedSourceId, setSelectedSourceId] = useState<string>(activeSources[0]?.id || '');
  const [qaPairs, setQaPairs] = useState<Array<{ question: string; answer: string }>>([
    { question: 'Full Name', answer: lead.name || '' },
    { question: 'Email Address', answer: lead.email || '' },
    { question: 'Phone Number', answer: lead.phone || '' },
    { question: 'Question 1', answer: '' },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  function updatePair(index: number, key: 'question' | 'answer', val: string) {
    setQaPairs((prev) => prev.map((pair, idx) => (idx === index ? { ...pair, [key]: val } : pair)));
  }

  function addPair() {
    setQaPairs((prev) => [...prev, { question: `Question ${prev.length + 1}`, answer: '' }]);
  }

  function removePair(index: number) {
    setQaPairs((prev) => prev.filter((_, idx) => idx !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        name: lead.name,
        email: lead.email || undefined,
        phone: lead.phone || undefined,
        __leadId: lead.id,
        __formName: formName.trim(),
      };

      for (const pair of qaPairs) {
        if (pair.question.trim() && pair.answer.trim()) {
          payload[pair.question.trim()] = pair.answer.trim();
        }
      }

      const targetSource = activeSources.find((s) => s.id === selectedSourceId) || activeSources[0];
      const token = targetSource?.token;

      if (!token) {
        throw new Error('No active capture source available. Please create a capture source first.');
      }

      await api.post<CaptureSubmitResponse>(CAPTURE_SOURCE_PATHS.publicSubmit(token), payload);

      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiFailure) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to record manual survey.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex flex-col">
            <h3 className="text-base font-bold text-slate-900">Add Manual Survey Response</h3>
            <span className="text-xs text-slate-500">
              Record answers received for <strong className="text-slate-800">{lead.name}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {error && <FormError>{error}</FormError>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            id="manual-form-name"
            label="Form / Survey Name *"
            value={formName}
            onChange={setFormName}
          />

          {activeSources.length > 0 && (
            <Select
              id="manual-source-select"
              label="Capture Source Endpoint"
              value={selectedSourceId}
              onChange={setSelectedSourceId}
              options={activeSources.map((s) => ({
                value: s.id,
                label: `${s.name} (${s.kind})`,
              }))}
            />
          )}

          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">Questions & Answers</span>
              <button
                type="button"
                onClick={addPair}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800"
              >
                + Add Question
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {qaPairs.map((pair, idx) => (
                <div key={idx} className="flex items-start gap-2 bg-white p-2 border border-slate-200 rounded">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <input
                      type="text"
                      placeholder="Question Title"
                      value={pair.question}
                      onChange={(e) => updatePair(idx, 'question', e.target.value)}
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-800 focus:border-teal-600 focus:outline-hidden"
                    />
                    <input
                      type="text"
                      placeholder="Answer Value"
                      value={pair.answer}
                      onChange={(e) => updatePair(idx, 'answer', e.target.value)}
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-teal-600 focus:outline-hidden"
                    />
                  </div>
                  {qaPairs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePair(idx)}
                      className="text-xs text-slate-400 hover:text-rose-600 pt-1"
                      title="Remove question"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

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
              disabled={isSubmitting || !formName.trim()}
              className="rounded bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {isSubmitting ? 'Saving…' : 'Record Submission'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
