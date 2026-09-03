import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CAPTURE_SOURCE_PATHS,
  type CaptureSourceListResponse,
  type CaptureSourceResponse,
  type CaptureSourceSummary,
} from '@erp/shared';
import { FormError } from '@erp/shared/ui';
import { ApiFailure, api, apiUrl } from '../../../api/client';
import { CaptureSourceModal } from '../components/CaptureSourceModal';

/**
 * The Apps Script that carries a Google Form's answers to a capture source.
 *
 * Google offers no webhook of its own, so this is the supported path: a trigger on the form
 * posts each response to the token URL. Every answer is keyed by its **question title**, so it
 * lands on the lead's Survey tab already readable — "Merchant Category", not "entry_1841203" —
 * with no per-question mapping to set up. Mapping stays optional and does one job: point the
 * question that holds the lead's name (or email/phone) at the built-in field, so a response
 * attaches to the lead it belongs to instead of creating a new one. A reworded question simply
 * shows under its new title; only a mapped one is worth keeping stable.
 */
function googleFormsScript(submitUrl: string): string {
  return [
    'function onFormSubmit(e) {',
    '  var payload = {};',
    '  e.response.getItemResponses().forEach(function (item) {',
    '    payload[item.getItem().getTitle()] = item.getResponse();',
    '  });',
    '',
    `  UrlFetchApp.fetch('${submitUrl}', {`,
    "    method: 'post',",
    "    contentType: 'application/json',",
    '    payload: JSON.stringify(payload),',
    '    muteHttpExceptions: true,',
    '  });',
    '}',
  ].join('\n');
}

export function CaptureSourcesPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<CaptureSourceSummary | undefined>();
  const [embedSource, setEmbedSource] = useState<CaptureSourceSummary | undefined>();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['crm', 'capture-sources'],
    queryFn: () => api.get<CaptureSourceListResponse>(CAPTURE_SOURCE_PATHS.sources),
  });

  const sources = query.data?.items ?? [];

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<CaptureSourceResponse>(CAPTURE_SOURCE_PATHS.source(id), { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm', 'capture-sources'] });
    },
  });

  const rotateToken = useMutation({
    mutationFn: (id: string) =>
      api.post<CaptureSourceResponse>(CAPTURE_SOURCE_PATHS.rotateToken(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm', 'capture-sources'] });
    },
  });

  /**
   * The URL a source is actually reachable at — an absolute URL a stranger's server can POST to.
   *
   * Both halves are load-bearing. The path comes from the contract, not hand-written: this page
   * used to spell out `/api/crm/capture/<token>`, and no such endpoint has ever existed — the
   * public one is `/api/public/capture/<token>`. The origin comes from `apiUrl` (the configured
   * `VITE_API_URL`), not `window.location.origin`: the API is deployed on its own host, so a URL
   * built from wherever the *UI* happens to be open — a Vercel frontend, or plain `localhost`
   * during development — points a Google Form at a host that does not run the API and that
   * Google's servers may not even reach. Every such submission failed silently, because the
   * capture endpoint is fire-and-forget and the Apps Script mutes its own HTTP errors.
   */
  function submitUrlFor(source: CaptureSourceSummary): string {
    return apiUrl(CAPTURE_SOURCE_PATHS.publicSubmit(source.token ?? ''));
  }

  function getEmbedSnippet(source: CaptureSourceSummary): string {
    if (source.kind === 'form') {
      const publicFormUrl = `${window.location.origin}/public/crm/form/${source.token}`;
      return `<iframe src="${publicFormUrl}" width="100%" height="600" frameborder="0"></iframe>`;
    }
    return googleFormsScript(submitUrlFor(source));
  }

  function handleCopySnippet(snippet: string, token: string) {
    void navigator.clipboard.writeText(snippet);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-slate-50/50 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Web Forms & Webhooks
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Capture lead submissions directly from published web forms or third-party webhook URLs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingSource(undefined);
            setIsModalOpen(true);
          }}
          className="rounded-md bg-teal-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-teal-800"
        >
          + New Capture Source
        </button>
      </header>

      {query.isLoading ? (
        <div className="text-xs text-slate-500 p-4">Loading capture sources…</div>
      ) : query.isError ? (
        <FormError>
          {query.error instanceof ApiFailure
            ? query.error.message
            : 'Failed to load capture sources.'}
        </FormError>
      ) : sources.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-white p-12 text-center shadow-xs">
          <div className="text-3xl mb-2">📋</div>
          <div className="text-base font-bold text-slate-800">No Capture Sources Defined</div>
          <p className="max-w-md text-xs text-slate-500 mt-1">
            Publish an embeddable web form or hand third-party tools a webhook URL to land submissions directly as Lead rows on your board.
          </p>
          <button
            type="button"
            onClick={() => {
              setEditingSource(undefined);
              setIsModalOpen(true);
            }}
            className="mt-4 rounded-md bg-teal-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-teal-800"
          >
            Create Your First Source
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      source.enabled
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {source.enabled ? 'Active' : 'Paused'}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase text-slate-600">
                    {source.kind}
                  </span>
                  <h3 className="text-base font-bold text-slate-900">{source.name}</h3>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEmbedSource(source)}
                    className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    {source.kind === 'form' ? 'Get Embed Snippet' : 'View Webhook URL'}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      toggleEnabled.mutate({ id: source.id, enabled: !source.enabled })
                    }
                    className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    {source.enabled ? 'Pause' : 'Resume'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          'Rotating the token will invalidate existing form embeds or webhooks. Proceed?',
                        )
                      ) {
                        rotateToken.mutate(source.id);
                      }
                    }}
                    className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Rotate Token
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingSource(source);
                      setIsModalOpen(true);
                    }}
                    className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white transition hover:bg-slate-900"
                  >
                    Edit
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
                <div>
                  <div className="text-slate-400">Public Token</div>
                  <code className="font-mono text-slate-800">{source.token}</code>
                </div>
                <div>
                  <div className="text-slate-400">Submissions Accepted</div>
                  <div className="font-semibold text-slate-800">{source.submissionCount}</div>
                </div>
                <div>
                  <div className="text-slate-400">Last Submission</div>
                  <div className="text-slate-800">
                    {source.lastSubmissionAt
                      ? new Date(source.lastSubmissionAt).toLocaleString()
                      : 'Never'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Created</div>
                  <div className="text-slate-800">
                    {new Date(source.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <CaptureSourceModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingSource(undefined);
          }}
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ['crm', 'capture-sources'] });
          }}
          initialSource={editingSource}
        />
      )}

      {embedSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {embedSource.kind === 'form' ? 'Embed Code Snippet' : 'Webhook Integration Details'}
              </h3>
              <button
                type="button"
                onClick={() => setEmbedSource(undefined)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-2 text-xs text-slate-600">
              {embedSource.kind === 'form' ? (
                <p>Copy and paste this HTML iframe snippet into your website or landing page HTML code:</p>
              ) : (
                <>
                  <p>
                    Post JSON to this URL. Anything that can make an HTTP request can use it —
                    Zapier, Make, your own site:
                  </p>
                  <code className="block break-all rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
                    {submitUrlFor(embedSource)}
                  </code>
                  <p className="pt-1">
                    <strong className="font-bold text-slate-800">For a Google Form:</strong> open
                    the form, choose <em>Extensions → Apps Script</em>, paste the script below,
                    then add a trigger for <code className="font-mono">onFormSubmit</code> on form
                    submit. Every answer then lands on the lead's Survey tab under its question
                    title — no mapping needed to read them.
                  </p>
                  <p>
                    Add just <strong className="font-bold text-slate-800">one</strong> mapping
                    below: the question holding the lead's name (or email/phone) → the matching
                    built-in field, so each response attaches to the right lead instead of
                    creating a new one. Type the question title exactly as it reads on the form.
                  </p>
                </>
              )}
            </div>

            <pre className="rounded border border-slate-300 bg-slate-900 p-4 text-xs font-mono text-emerald-400 whitespace-pre-wrap overflow-x-auto">
              {getEmbedSnippet(embedSource)}
            </pre>

            <div className="flex justify-between items-center pt-2">
              <span className="text-xs text-emerald-600 font-medium">
                {copiedToken === embedSource.token ? '✓ Snippet copied to clipboard!' : ''}
              </span>
              <button
                type="button"
                onClick={() =>
                  handleCopySnippet(getEmbedSnippet(embedSource), embedSource.token || '')
                }
                className="rounded bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Copy Snippet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
