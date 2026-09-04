import React, { useEffect, useRef, useState } from 'react';
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
import { Button, Modal } from '@erp/shared/ui';

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
  /**
   * The submit button sits on the dialog's footer bar, which is outside the form element —
   * that is what keeps it reachable without scrolling a long compose box. `requestSubmit`
   * rather than `submit` so the form's own validation and `onSubmit` still run.
   */
  const formRef = useRef<HTMLFormElement>(null);

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
    <Modal
      onClose={onClose}
      icon="✉️"
      title={`Email ${leadName}`}
      description={
        leadEmail ? (
          <>
            Going to <span className="font-mono text-slate-700">{leadEmail}</span>
          </>
        ) : (
          <span className="font-semibold text-amber-700">
            This lead has no email address on file.
          </span>
        )
      }
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={sending || mailboxes.length === 0}
            onClick={() => formRef.current?.requestSubmit()}
          >
            {sending ? 'Sending...' : 'Send email'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
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

        {/*
          Nothing on this form can work without a mailbox, so the blocker is stated once at the
          top with the fix attached, rather than left to be discovered when Send does nothing.
        */}
        {mailboxes.length === 0 && !loading && (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div>
              <p className="text-xs font-bold text-amber-900">No mailbox connected</p>
              <p className="mt-0.5 text-[11px] text-amber-800">
                Connect Gmail, Outlook, or your company mailbox before sending.
              </p>
            </div>
            {onOpenMailboxesModal && (
              <Button
                variant="primary"
                onClick={() => {
                  onClose();
                  onOpenMailboxesModal();
                }}
              >
                Connect mailbox
              </Button>
            )}
          </div>
        )}

        <div className="flex gap-1 border-b border-slate-200 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setPreviewTab('compose')}
            aria-current={previewTab === 'compose' ? 'true' : undefined}
            className={TAB(previewTab === 'compose')}
          >
            Compose
          </button>
          <button
            type="button"
            onClick={handleGeneratePreview}
            aria-current={previewTab === 'preview' ? 'true' : undefined}
            className={TAB(previewTab === 'preview')}
          >
            Preview
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSend} className="flex flex-col gap-4">
          {previewTab === 'compose' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-700">From</span>
                  <select
                    id="mailbox-select"
                    value={selectedMailboxId}
                    onChange={(e) => setSelectedMailboxId(e.target.value)}
                    className={INPUT}
                  >
                    {mailboxes.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName} ({m.emailAddress})
                        {m.isShared || m.provider === 'smtp' ? ' — 🏢 Company Mailbox' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-700">Template</span>
                  <select
                    id="template-select"
                    value={selectedTemplateId}
                    onChange={(e) => handleSelectTemplate(e.target.value)}
                    className={INPUT}
                  >
                    <option value="">Write a one-off email</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  Subject
                  {selectedTemplateId && (
                    <span className="font-normal text-slate-400">— set by the template</span>
                  )}
                </span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Quick intro call with {{lead.name}}"
                  disabled={!!selectedTemplateId}
                  className={`${INPUT} font-mono disabled:bg-slate-50 disabled:text-slate-500`}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  Body
                  {selectedTemplateId && (
                    <span className="font-normal text-slate-400">— set by the template</span>
                  )}
                </span>
                <textarea
                  rows={9}
                  value={htmlBody}
                  onChange={(e) => setHtmlBody(e.target.value)}
                  placeholder="Hi {{lead.name}},&#10;&#10;I wanted to follow up on our conversation..."
                  disabled={!!selectedTemplateId}
                  className={`${INPUT} font-mono disabled:bg-slate-50 disabled:text-slate-500`}
                />
              </label>
            </>
          ) : (
            /*
              The preview is dressed as the mail client it is standing in for — a white sheet
              with the headers above it — rather than as another panel of this form, so what is
              being checked is obviously the message and not the editor.
            */
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex flex-col gap-1 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">To</span>{' '}
                  {leadEmail || 'lead@example.com'}
                </div>
                <div className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">Subject</span>{' '}
                  <span className="font-bold text-slate-900">{previewData?.subject}</span>
                </div>
              </div>

              <div className="prose prose-sm max-w-none bg-white p-4 text-sm leading-relaxed text-slate-800">
                <div
                  dangerouslySetInnerHTML={{
                    __html: previewData?.htmlBody || '<p>No content to preview yet.</p>',
                  }}
                />
              </div>
            </div>
          )}
        </form>
      </div>
    </Modal>
  );
};

/** One input rule for the form, so the two selects and the two text boxes stay one control. */
const INPUT =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20';

/** Compose/Preview. Underlined rather than filled — a tab is a place, not an action. */
const TAB = (active: boolean) =>
  `-mb-px border-b-2 px-3 pb-2 pt-1 transition ${
    active
      ? 'border-teal-600 text-teal-700'
      : 'border-transparent text-slate-500 hover:text-slate-800'
  }`;
