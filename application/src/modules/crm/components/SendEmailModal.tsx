import React, { useEffect, useState } from 'react';
import {
  EMAIL_TEMPLATE_PATHS,
  LEAD_EMAIL_PATHS,
  MAILBOX_PATHS,
  type EmailTemplateListResponse,
  type EmailTemplateSummary,
  type MailboxConnectionListResponse,
  type MailboxConnectionSummary,
  type PreviewTemplateResponse,
  type SendLeadEmailRequest,
  type SendLeadEmailResponse,
} from '@erp/shared';
import { api } from '../../../api/client';

interface SendEmailModalProps {
  isOpen: boolean;
  leadId: string;
  leadName: string;
  leadEmail?: string | null;
  onClose: () => void;
  onSuccess: () => void;
  onOpenMailboxesModal?: () => void;
}

export const SendEmailModal: React.FC<SendEmailModalProps> = ({
  isOpen,
  leadId,
  leadName,
  leadEmail,
  onClose,
  onSuccess,
  onOpenMailboxesModal,
}) => {
  const [mailboxes, setMailboxes] = useState<MailboxConnectionSummary[]>([]);
  const [templates, setTemplates] = useState<EmailTemplateSummary[]>([]);

  const [selectedMailboxId, setSelectedMailboxId] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [htmlBody, setHtmlBody] = useState<string>('');

  const [previewTab, setPreviewTab] = useState<'compose' | 'preview'>('compose');
  const [previewData, setPreviewData] = useState<PreviewTemplateResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [mRes, tRes] = await Promise.all([
        api.get<MailboxConnectionListResponse>(MAILBOX_PATHS.mailboxes),
        api.get<EmailTemplateListResponse>(EMAIL_TEMPLATE_PATHS.templates),
      ]);

      const activeMailboxes = (mRes.items || []).filter((m: MailboxConnectionSummary) => m.status === 'connected');
      setMailboxes(activeMailboxes);
      if (activeMailboxes.length > 0 && !selectedMailboxId) {
        setSelectedMailboxId(activeMailboxes[0]?.id || '');
      }

      setTemplates(tRes.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load mailboxes or templates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
      setSubject('');
      setHtmlBody('');
      setSelectedTemplateId('');
      setPreviewTab('compose');
      setPreviewData(null);
      setError(null);
    }
  }, [isOpen, leadId]);

  const handleSelectTemplate = (tId: string) => {
    setSelectedTemplateId(tId);
    if (!tId) {
      return;
    }

    const t = templates.find((item) => item.id === tId);
    if (t) {
      setSubject(t.subject);
      setHtmlBody(t.body);
    }
  };

  const handleGeneratePreview = async () => {
    if (!selectedMailboxId) {
      setError('Please select a connected mailbox.');
      return;
    }

    try {
      setError(null);
      if (selectedTemplateId) {
        const preview = await api.post<PreviewTemplateResponse>(
          EMAIL_TEMPLATE_PATHS.preview(selectedTemplateId),
          { leadId, mailboxConnectionId: selectedMailboxId },
        );
        setPreviewData(preview);
      } else {
        // Fallback local preview
        const mb = mailboxes.find((m) => m.id === selectedMailboxId);
        const previewSub = subject
          .replace(/\{\{lead\.name\}\}/g, leadName)
          .replace(/\{\{lead\.email\}\}/g, leadEmail || 'lead@example.com')
          .replace(/\{\{sender\.displayName\}\}/g, mb?.displayName || 'Sales Representative');
        const previewHtml = htmlBody
          .replace(/\{\{lead\.name\}\}/g, leadName)
          .replace(/\{\{lead\.email\}\}/g, leadEmail || 'lead@example.com')
          .replace(/\{\{sender\.displayName\}\}/g, mb?.displayName || 'Sales Representative');

        setPreviewData({
          subject: previewSub,
          htmlBody: previewHtml,
          textBody: previewHtml.replace(/<[^>]+>/g, ''),
        });
      }
      setPreviewTab('preview');
    } catch (err: any) {
      setError(err.message || 'Failed to generate email preview.');
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMailboxId) {
      setError('Select a connected mailbox to send from.');
      return;
    }

    if (!subject.trim() && !selectedTemplateId) {
      setError('Please enter an email subject.');
      return;
    }

    try {
      setSending(true);
      setError(null);

      const payload: SendLeadEmailRequest = {
        mailboxConnectionId: selectedMailboxId,
        templateId: selectedTemplateId || undefined,
        subject: selectedTemplateId ? undefined : subject,
        htmlBody: selectedTemplateId ? undefined : htmlBody,
      };

      const res = await api.post<SendLeadEmailResponse>(
        LEAD_EMAIL_PATHS.sendEmail(leadId),
        payload,
      );

      if (res.success) {
        onSuccess();
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send email.');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-5 text-slate-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span>✉️</span> Send 1-on-1 Email to <span className="text-amber-400">{leadName}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Recipient: <code className="text-slate-300 font-mono">{leadEmail || 'No email provided'}</code>
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

        {mailboxes.length === 0 && !loading && (
          <div className="p-4 bg-amber-950/40 border border-amber-800/80 rounded-xl text-amber-200 text-xs flex items-center justify-between">
            <div>
              <span className="font-bold">No active mailbox connected!</span>
              <p className="text-[11px] text-amber-300/80 mt-0.5">
                Connect your Gmail or Outlook account before sending emails.
              </p>
            </div>
            {onOpenMailboxesModal && (
              <button
                onClick={() => {
                  onClose();
                  onOpenMailboxesModal();
                }}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg shadow transition"
              >
                Connect Mailbox
              </button>
            )}
          </div>
        )}

        {/* Tab Toggle */}
        <div className="flex border-b border-slate-800 gap-4 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setPreviewTab('compose')}
            className={`pb-2 border-b-2 transition ${
              previewTab === 'compose'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Compose Email
          </button>
          <button
            type="button"
            onClick={handleGeneratePreview}
            className={`pb-2 border-b-2 transition ${
              previewTab === 'preview'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Live Preview
          </button>
        </div>

        <form onSubmit={handleSend} className="flex-1 overflow-y-auto space-y-4 pr-1">
          {previewTab === 'compose' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="mailbox-select" className="block text-xs font-semibold text-slate-300 mb-1">From Mailbox</label>
                  <select
                    id="mailbox-select"
                    value={selectedMailboxId}
                    onChange={(e) => setSelectedMailboxId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                  >
                    {mailboxes.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName} ({m.emailAddress})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="template-select" className="block text-xs font-semibold text-slate-300 mb-1">
                    Select Template (Optional)
                  </label>
                  <select
                    id="template-select"
                    value={selectedTemplateId}
                    onChange={(e) => handleSelectTemplate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                  >
                    <option value="">-- Custom Email --</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Quick intro call with {{lead.name}}"
                  disabled={!!selectedTemplateId}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500 disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Email Body (HTML/Text)</label>
                <textarea
                  rows={8}
                  value={htmlBody}
                  onChange={(e) => setHtmlBody(e.target.value)}
                  placeholder="Hi {{lead.name}},&#10;&#10;I wanted to follow up on our previous conversation..."
                  disabled={!!selectedTemplateId}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500 disabled:opacity-60"
                />
              </div>
            </>
          ) : (
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-4 font-sans">
              <div className="border-b border-slate-800 pb-3 space-y-1">
                <div className="text-xs text-slate-400">
                  <span className="font-semibold text-slate-300">Subject:</span>{' '}
                  <span className="text-amber-300 font-bold">{previewData?.subject}</span>
                </div>
                <div className="text-xs text-slate-400">
                  <span className="font-semibold text-slate-300">To:</span> {leadEmail || 'lead@example.com'}
                </div>
              </div>

              <div className="text-xs text-slate-200 leading-relaxed bg-slate-900/80 p-4 rounded-lg border border-slate-800/80 prose prose-invert max-w-none">
                <div
                  dangerouslySetInnerHTML={{
                    __html: previewData?.htmlBody || '<p>No content preview available.</p>',
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending || mailboxes.length === 0}
              className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-lg shadow-md transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {sending ? (
                <>
                  <span className="animate-spin">⏳</span> Sending...
                </>
              ) : (
                <>
                  <span>🚀</span> Send Email
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
