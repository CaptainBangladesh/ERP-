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
  }, [isOpen]);

  const handleConnect = async (provider: MailboxProvider) => {
    try {
      setConnecting(provider);
      setError(null);
      const urlRes = await api.post<{ url: string; stateToken: string }>(
        MAILBOX_PATHS.connectUrl,
        { provider },
      );

      // Trigger OAuth callback directly for mock authentication
      const callbackRes = await api.get<{ success: boolean; mailboxId: string }>(
        MAILBOX_PATHS.callback + `?state=${urlRes.stateToken}&code=mock_oauth_code_123`,
      );

      if (callbackRes.success) {
        await fetchMailboxes();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect mailbox.');
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      setError(null);
      await api.post(MAILBOX_PATHS.disconnect(id), {});
      await fetchMailboxes();
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect mailbox.');
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
              Connect your Gmail or Outlook account to send 1-on-1 emails directly from CRM.
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

        {/* Connect Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleConnect('gmail')}
            disabled={connecting !== null}
            className="flex items-center justify-center gap-2.5 px-4 py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-sm font-semibold rounded-lg shadow-md transition disabled:opacity-50"
          >
            {connecting === 'gmail' ? (
              <span className="animate-spin text-lg">⏳</span>
            ) : (
              <span className="text-base">🔴</span>
            )}
            <span>Connect Gmail</span>
          </button>

          <button
            onClick={() => handleConnect('outlook')}
            disabled={connecting !== null}
            className="flex items-center justify-center gap-2.5 px-4 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-sm font-semibold rounded-lg shadow-md transition disabled:opacity-50"
          >
            {connecting === 'outlook' ? (
              <span className="animate-spin text-lg">⏳</span>
            ) : (
              <span className="text-base">🔷</span>
            )}
            <span>Connect Outlook</span>
          </button>
        </div>

        {/* Connected Mailboxes List */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Connected Mailboxes ({mailboxes.length})
          </h3>

          {loading ? (
            <div className="text-center py-6 text-slate-400 text-xs">Loading mailboxes...</div>
          ) : mailboxes.length === 0 ? (
            <div className="text-center py-8 bg-slate-950/40 rounded-lg border border-dashed border-slate-800 text-slate-400 text-xs">
              No mailbox connected yet. Click above to connect Gmail or Outlook.
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
                      {mb.provider === 'gmail' ? '🔴' : '🔷'}
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

                  {mb.status === 'connected' && (
                    <button
                      onClick={() => handleDisconnect(mb.id)}
                      className="px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-950/40 hover:text-red-300 border border-red-900/60 rounded-md transition"
                    >
                      Disconnect
                    </button>
                  )}
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
