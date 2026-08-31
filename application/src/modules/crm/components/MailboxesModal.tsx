import React, { useEffect, useState } from 'react';
import {
  MAILBOX_PATHS,
  type MailboxConnectionListResponse,
  type MailboxConnectionSummary,
  type MailboxProvider,
} from '@erp/shared';
import { api } from '../../../api/client';

interface MailboxesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MailboxesModal: React.FC<MailboxesModalProps> = ({ isOpen, onClose }) => {
  const [mailboxes, setMailboxes] = useState<MailboxConnectionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState<MailboxProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMailboxes = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get<MailboxConnectionListResponse>(MAILBOX_PATHS.mailboxes);
      setMailboxes(res.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load mailbox connections.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMailboxes();
    }

    // The popup reports what actually happened. Only a message from this origin is trusted:
    // any page the user has open can post to this window, and this one acts on what it says.
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'MAILBOX_CONNECTION_RESULT') return;

      setConnecting(null);
      if (event.data.connected) {
        setError(null);
        fetchMailboxes();
      } else {
        // Nothing was connected, so there is nothing new to fetch — saying so is the whole
        // point. This modal used to refresh the list either way and show whatever appeared.
        setError(event.data.message || 'The mailbox was not connected.');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isOpen]);

  const handleConnect = async (provider: MailboxProvider) => {
    // Open popup synchronously during click event so browser popup blocker never blocks it
    const popup = window.open('about:blank', 'google_oauth_popup', 'width=600,height=700,scrollbars=yes');

    try {
      setConnecting(provider);
      setError(null);
      const urlRes = await api.post<{ url: string; stateToken: string }>(
        MAILBOX_PATHS.connectUrl,
        { provider },
      );

      // The only way a mailbox gets connected: the provider's own consent screen. There is
      // no second path that fabricates a connection when this one is unavailable — the
      // server refuses instead, and the message lands in `error` below.
      if (popup) {
        popup.location.href = urlRes.url;
      } else {
        window.location.href = urlRes.url;
      }

      // `connecting` stays set until the popup posts its result back.
      return;
    } catch (err: any) {
      if (popup && !popup.closed) popup.close();
      setError(err.message || 'Failed to connect mailbox.');
      setConnecting(null);
    }
  };

  const [showSmtpForm, setShowSmtpForm] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [smtpForm, setSmtpForm] = useState(emptySmtpForm);

  /** Stops sending from a mailbox, keeping it on the list so it can be reconnected. */
  const handleDisconnect = async (id: string) => {
    try {
      setError(null);
      await api.post(MAILBOX_PATHS.disconnect(id), {});
      await fetchMailboxes();
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect mailbox.');
    }
  };

  /**
   * Deletes the connection. The other half of disconnecting — this is what a mailbox that is
   * already revoked needs, and what the button labelled "Remove" used not to do: it posted to
   * the same revoke endpoint, so the row it was meant to clear stayed exactly where it was.
   */
  const handleRemove = async (id: string) => {
    try {
      setError(null);
      await api.delete(MAILBOX_PATHS.remove(id));
      await fetchMailboxes();
    } catch (err: any) {
      setError(err.message || 'Failed to remove mailbox.');
    }
  };

  /**
   * Adds a company mailbox from its SMTP settings.
   *
   * No popup and no provider: the credentials go straight to our own API, which proves them
   * against the mail host before storing anything. A rejection here means nothing was saved.
   */
  const handleAddSmtp = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setSavingSmtp(true);
      setError(null);
      await api.post(MAILBOX_PATHS.connectSmtp, {
        ...smtpForm,
        port: Number(smtpForm.port),
        username: smtpForm.username.trim() || smtpForm.emailAddress.trim(),
        displayName: smtpForm.displayName.trim() || smtpForm.emailAddress.trim(),
      });
      setSmtpForm(emptySmtpForm);
      setShowSmtpForm(false);
      await fetchMailboxes();
    } catch (err: any) {
      setError(err.message || 'Failed to add company mailbox.');
    } finally {
      setSavingSmtp(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-6 text-slate-100">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span>📧</span> Mailbox Connections
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Send from your personal Gmail, or from your company's own mail account.
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

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleConnect('gmail')}
            disabled={connecting !== null}
            className="flex items-center justify-center gap-2.5 px-4 py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-sm font-semibold rounded-lg shadow-md transition disabled:opacity-50"
          >
            <span className="text-base">🔴</span>
            <span>{connecting === 'gmail' ? 'Connecting to Google...' : 'Connect Gmail'}</span>
          </button>

          <button
            onClick={() => handleConnect('outlook')}
            disabled={connecting !== null}
            className="flex items-center justify-center gap-2.5 px-4 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-sm font-semibold rounded-lg shadow-md transition disabled:opacity-50"
          >
            <span className="text-base">🔷</span>
            <span>{connecting === 'outlook' ? 'Connecting...' : 'Connect Outlook'}</span>
          </button>
        </div>

        {/* The third way in, and the only one that works for company mail hosting: no
            provider to consent at, just the settings the host gave you. */}
        {!showSmtpForm ? (
          <button
            onClick={() => setShowSmtpForm(true)}
            className="w-full px-4 py-2.5 text-sm font-semibold text-slate-200 bg-slate-800/70 hover:bg-slate-800 border border-slate-700 rounded-lg transition"
          >
            🏢 Add company mailbox (SMTP)
          </button>
        ) : (
          <form
            onSubmit={handleAddSmtp}
            className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Company mailbox
              </h3>
              <button
                type="button"
                onClick={() => setShowSmtpForm(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-500">
              Your mail host's outgoing (SMTP) settings. For Namecheap Private Email that is
              mail.privateemail.com on port 465. The password is encrypted before it is stored
              and is never shown again.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <SmtpField
                label="Host"
                value={smtpForm.host}
                placeholder="mail.privateemail.com"
                onChange={(host) => setSmtpForm({ ...smtpForm, host })}
              />
              <SmtpField
                label="Port"
                value={smtpForm.port}
                placeholder="465"
                onChange={(port) => setSmtpForm({ ...smtpForm, port })}
              />
            </div>

            <SmtpField
              label="Email address"
              value={smtpForm.emailAddress}
              placeholder="sales@yourcompany.com"
              onChange={(emailAddress) => setSmtpForm({ ...smtpForm, emailAddress })}
            />
            <SmtpField
              label="Sender name"
              value={smtpForm.displayName}
              placeholder="Your Company Sales"
              onChange={(displayName) => setSmtpForm({ ...smtpForm, displayName })}
            />
            <SmtpField
              label="Username"
              value={smtpForm.username}
              placeholder="usually the same as the address"
              onChange={(username) => setSmtpForm({ ...smtpForm, username })}
            />
            <SmtpField
              label="Password"
              type="password"
              value={smtpForm.password}
              onChange={(password) => setSmtpForm({ ...smtpForm, password })}
            />

            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={smtpForm.secure}
                onChange={(event) =>
                  setSmtpForm({ ...smtpForm, secure: event.target.checked })
                }
                className="rounded border-slate-700 bg-slate-900"
              />
              Use SSL (port 465). Leave off for STARTTLS on 587.
            </label>

            <button
              type="submit"
              disabled={savingSmtp}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {savingSmtp ? 'Checking with your mail server…' : 'Add mailbox'}
            </button>
          </form>
        )}

        {/* Connected Mailboxes List */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Connected Mailboxes ({mailboxes.length})
          </h3>

          {loading ? (
            <div className="text-center py-6 text-slate-400 text-xs">Loading mailboxes...</div>
          ) : mailboxes.length === 0 ? (
            <div className="text-center py-8 bg-slate-950/40 rounded-lg border border-dashed border-slate-800 text-slate-400 text-xs">
              No mailbox yet. Connect a personal account above, or add your company mailbox.
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {mailboxes.map((mb) => (
                <div
                  key={mb.id}
                  className="flex items-center justify-between p-3.5 bg-slate-950/60 border border-slate-800 rounded-lg hover:border-slate-700 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-base">
                      {mb.provider === 'gmail' ? '🔴' : mb.provider === 'smtp' ? '🏢' : '🔷'}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-200 flex items-center gap-2">
                        {mb.displayName}
                        <span
                          className={`px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wider ${
                            mb.status === 'connected'
                              ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/80'
                              : 'bg-red-950/80 text-red-400 border border-red-800/80'
                          }`}
                        >
                          {mb.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">{mb.emailAddress}</div>
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      mb.status === 'connected' ? handleDisconnect(mb.id) : handleRemove(mb.id)
                    }
                    className="px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-950/40 hover:text-red-300 border border-red-900/60 rounded-md transition"
                  >
                    {mb.status === 'connected' ? 'Disconnect' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

const emptySmtpForm = {
  host: '',
  port: '465',
  secure: true,
  emailAddress: '',
  displayName: '',
  username: '',
  password: '',
};

/** One labelled input in the company-mailbox form, so the form is markup and not plumbing. */
function SmtpField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
      />
    </label>
  );
}
