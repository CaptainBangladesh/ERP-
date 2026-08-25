import React, { useEffect, useState } from 'react';
import {
  EMAIL_TEMPLATE_PATHS,
  type CreateEmailTemplateRequest,
  type EmailTemplateListResponse,
  type EmailTemplateSummary,
} from '@erp/shared';
import { api } from '../../../api/client';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-6 text-slate-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span>📋</span> Email Templates
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Create reusable email templates with dynamic tags like <code className="text-amber-300">{"{{lead.name}}"}</code>.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-lg p-1 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-lg text-red-300 text-xs flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200">
              ✕
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-6 pr-1">
          {isCreating || editingTemplate ? (
            <form onSubmit={handleSave} className="space-y-4 bg-slate-950/60 p-4 border border-slate-800 rounded-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-amber-400">
                  {editingTemplate ? 'Edit Template' : 'New Template'}
                </h3>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Template Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sales Intro & Demo Pitch"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Tag Injector toolbar */}
              <div>
                <div className="text-[11px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                  Insert Dynamic Tag:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {dynamicTags.map((dt) => (
                    <div key={dt.tag} className="inline-flex rounded-md shadow-sm">
                      <button
                        type="button"
                        onClick={() => handleInsertTag(dt.tag, 'subject')}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-mono border border-slate-700 rounded-l-md transition"
                        title="Add to Subject"
                      >
                        Sub: {dt.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInsertTag(dt.tag, 'body')}
                        className="px-2 py-1 bg-amber-950/50 hover:bg-amber-900/60 text-amber-300 text-[11px] font-mono border-t border-b border-r border-amber-900/60 rounded-r-md transition"
                        title="Add to Body"
                      >
                        Body: {dt.label}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject line with {{lead.name}}..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">HTML Body</label>
                <textarea
                  rows={6}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="<p>Hi {{lead.name}},</p><p>Welcome to our platform!</p>"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg shadow-md transition disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingTemplate ? 'Update Template' : 'Save Template'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Saved Templates ({templates.length})
                </h3>
                <button
                  onClick={handleStartCreate}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg shadow transition flex items-center gap-1.5"
                >
                  <span>+</span> New Template
                </button>
              </div>

              {loading ? (
                <div className="text-center py-8 text-slate-400 text-xs">Loading templates...</div>
              ) : templates.length === 0 ? (
                <div className="text-center py-10 bg-slate-950/40 rounded-xl border border-dashed border-slate-800 text-slate-400 text-xs">
                  No templates created yet. Click "+ New Template" above.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {templates.map((t) => (
                    <div
                      key={t.id}
                      className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl hover:border-slate-700 transition flex items-start justify-between gap-4"
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-slate-100">{t.name}</h4>
                        </div>
                        <div className="text-xs font-mono text-amber-300/90 truncate">
                          Sub: {t.subject}
                        </div>
                        <div className="text-xs text-slate-400 line-clamp-2 font-mono">
                          {t.body}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => handleStartEdit(t)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 border border-slate-700 rounded-md transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-950/40 border border-red-900/60 rounded-md transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
