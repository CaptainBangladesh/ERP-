import React, { useEffect, useState } from 'react';
import {
  EMAIL_TEMPLATE_PATHS,
  type CreateEmailTemplateRequest,
  type EmailTemplateListResponse,
  type EmailTemplateSummary,
} from '@erp/shared';
import { api } from '../../../api/client';
import { Button, Modal } from '@erp/shared/ui';

interface EmailTemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EmailTemplatesModal: React.FC<EmailTemplatesModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [templates, setTemplates] = useState<EmailTemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplateSummary | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get<EmailTemplateListResponse>(EMAIL_TEMPLATE_PATHS.templates);
      setTemplates(res.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load email templates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
      resetForm();
    }
  }, [isOpen]);

  const resetForm = () => {
    setEditingTemplate(null);
    setIsCreating(false);
    setName('');
    setSubject('');
    setBody('');
    setError(null);
  };

  const handleStartCreate = () => {
    resetForm();
    setIsCreating(true);
  };

  const handleStartEdit = (t: EmailTemplateSummary) => {
    setEditingTemplate(t);
    setIsCreating(false);
    setName(t.name);
    setSubject(t.subject);
    setBody(t.body);
    setError(null);
  };

  const handleInsertTag = (tag: string, target: 'subject' | 'body') => {
    if (target === 'subject') {
      setSubject((prev) => prev + ` ${tag}`);
    } else {
      setBody((prev) => prev + ` ${tag}`);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !subject.trim() || !body.trim()) {
      setError('Please fill in all template fields (Name, Subject, and Body).');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const payload: CreateEmailTemplateRequest = {
        name: name.trim(),
        subject: subject.trim(),
        body: body.trim(),
      };

      if (editingTemplate) {
        await api.patch(EMAIL_TEMPLATE_PATHS.template(editingTemplate.id), payload);
      } else {
        await api.post(EMAIL_TEMPLATE_PATHS.templates, payload);
      }

      await fetchTemplates();
      resetForm();
    } catch (err: any) {
      setError(err.message || 'Failed to save email template.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this template?')) return;

    try {
      setError(null);
      await api.delete(EMAIL_TEMPLATE_PATHS.template(id));
      await fetchTemplates();
      if (editingTemplate?.id === id) resetForm();
    } catch (err: any) {
      setError(err.message || 'Failed to delete email template.');
    }
  };

  if (!isOpen) return null;

  const dynamicTags = [
    { label: 'Lead Name', tag: '{{lead.name}}' },
    { label: 'Lead Email', tag: '{{lead.email}}' },
    { label: 'Org Name', tag: '{{lead.organisationName}}' },
    { label: 'Sender Name', tag: '{{sender.displayName}}' },
    { label: 'Sender Email', tag: '{{sender.emailAddress}}' },
  ];

  return (
    <Modal
      onClose={onClose}
      icon="📋"
      title="Email templates"
      description={
        <>
          Reusable emails with dynamic tags like{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-teal-700">
            {'{{lead.name}}'}
          </code>
          , filled in from the lead when the message is sent.
        </>
      }
      size="lg"
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-5">
        {error && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss"
              className="shrink-0 text-red-400 transition hover:text-red-700"
            >
              ✕
            </button>
          </div>
        )}

        {isCreating || editingTemplate ? (
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {editingTemplate ? 'Edit template' : 'New template'}
              </h3>
              <Button variant="ghost" size="sm" onClick={resetForm}>
                Cancel
              </Button>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-700">Template name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sales intro and demo pitch"
                className={INPUT}
              />
            </label>

            {/*
              The tags are the part of this form nobody can guess, so they are offered as
              buttons rather than documented in a placeholder — and each one says which box it
              lands in, because a tag inserted into the wrong field looks identical.
            */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Insert a tag
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dynamicTags.map((dt) => (
                  <div
                    key={dt.tag}
                    className="inline-flex overflow-hidden rounded-md border border-slate-300 bg-white shadow-2xs"
                  >
                    <button
                      type="button"
                      onClick={() => handleInsertTag(dt.tag, 'subject')}
                      title={`Add ${dt.tag} to the subject`}
                      className="px-2 py-1 font-mono text-[11px] text-slate-600 transition hover:bg-slate-100"
                    >
                      {dt.label}
                      <span className="ml-1 text-slate-400">subject</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInsertTag(dt.tag, 'body')}
                      title={`Add ${dt.tag} to the body`}
                      className="border-l border-slate-300 bg-teal-50 px-2 py-1 font-mono text-[11px] font-semibold text-teal-700 transition hover:bg-teal-100"
                    >
                      body
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-700">Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject line with {{lead.name}}..."
                className={`${INPUT} font-mono`}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-700">HTML body</span>
              <textarea
                rows={7}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="<p>Hi {{lead.name}},</p><p>Welcome aboard.</p>"
                className={`${INPUT} font-mono`}
              />
            </label>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button onClick={resetForm}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving...' : editingTemplate ? 'Update template' : 'Save template'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Saved templates ({templates.length})
              </h3>
              <Button variant="primary" onClick={handleStartCreate}>
                <span aria-hidden="true">+</span> New template
              </Button>
            </div>

            {loading ? (
              <p className="py-10 text-center text-xs text-slate-500">Loading templates...</p>
            ) : templates.length === 0 ? (
              /*
                An empty state that offers the action rather than describing where to find it.
                The old copy pointed at a button above itself, which is a sentence a person has
                to read and then translate into a click.
              */
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
                <span aria-hidden="true" className="text-2xl opacity-60">
                  📋
                </span>
                <p className="text-xs text-slate-500">
                  No templates yet. Write one once and send it to any lead in two clicks.
                </p>
                <Button variant="primary" onClick={handleStartCreate}>
                  <span aria-hidden="true">+</span> New template
                </Button>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {templates.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-2xs"
                  >
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-bold text-slate-900">{t.name}</h4>
                      <p className="mt-1 truncate font-mono text-xs text-teal-700">{t.subject}</p>
                      <p className="mt-1 line-clamp-2 font-mono text-xs text-slate-500">{t.body}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button size="sm" onClick={() => handleStartEdit(t)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(t.id)}>
                        <span className="text-red-600">Delete</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

/** One input rule for this form, so subject and body cannot drift apart from the name box. */
const INPUT =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20';
