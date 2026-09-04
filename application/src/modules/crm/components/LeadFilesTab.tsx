import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LEAD_PATHS, type LeadAttachmentListResponse, type LeadAttachmentResponse } from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';

/**
 * The Files tab: browse and open what is actually attached to a lead.
 *
 * The find-it tab for an artifact, so a salesperson can reach a quote without scrolling the
 * whole Timeline. Every upload is a real multipart upload and every file listed here can be
 * opened and previewed — a name with no bytes behind it is the failure this tab exists to have fixed.
 */

interface LeadFilesTabProps {
  leadId: string;
  canWrite: boolean;
}

export function LeadFilesTab({ leadId, canWrite }: LeadFilesTabProps) {
  const queryClient = useQueryClient();
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<LeadAttachmentResponse | null>(null);

  const queryKey = ['crm', 'leads', 'files', leadId];

  const filesQuery = useQuery({
    queryKey,
    queryFn: () => api.get<LeadAttachmentListResponse>(LEAD_PATHS.files(leadId)),
    enabled: Boolean(leadId),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.postForm<LeadAttachmentResponse>(LEAD_PATHS.files(leadId), form);
    },
    onSettled: () => setUploading(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      // The upload logs an audit event, so the feed beside this tab is now out of date.
      void queryClient.invalidateQueries({ queryKey: ['crm', 'activities', 'lead', leadId] });
    },
  });

  const remove = useMutation({
    mutationFn: (fileId: string) => api.delete(LEAD_PATHS.file(leadId, fileId)),
    onSuccess: () => {
      setPreviewFile(null);
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const failure =
    upload.error instanceof ApiFailure
      ? upload.error
      : remove.error instanceof ApiFailure
        ? remove.error
        : undefined;
  const files = filesQuery.data?.items ?? [];

  function attach(file: File | undefined) {
    if (!file || !canWrite) return;
    setUploading(file.name);
    upload.mutate(file);
  }

  function onDrag(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(event.type === 'dragenter' || event.type === 'dragover');
  }

  return (
    <section aria-label="Files" className="flex flex-col gap-4">
      {canWrite && (
        <div
          onDragEnter={onDrag}
          onDragLeave={onDrag}
          onDragOver={onDrag}
          onDrop={(event) => {
            onDrag(event);
            setDragActive(false);
            attach(event.dataTransfer.files?.[0]);
          }}
          className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-center transition ${
            dragActive ? 'border-teal-500 bg-teal-50/60' : 'border-slate-300 bg-white hover:border-slate-400'
          }`}
        >
          <span aria-hidden="true" className="text-2xl">
            📁
          </span>
          <p className="text-xs font-bold text-slate-800">
            {upload.isPending ? `Uploading ${uploading ?? 'file'}…` : 'Drag a quote, proposal or photo here'}
          </p>
          <p className="text-[11px] text-slate-500">Documents, spreadsheets and images, up to 25 MB.</p>

          <label className="mt-2 cursor-pointer rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-slate-800">
            Browse files
            <input
              type="file"
              aria-label="Choose a file to attach"
              className="hidden"
              disabled={upload.isPending}
              onChange={(event) => attach(event.target.files?.[0])}
            />
          </label>
        </div>
      )}

      {failure && (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          {failure.message}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-900">Attachments</h3>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </span>
        </div>

        {filesQuery.isPending && (
          <p role="status" className="py-4 text-center text-xs text-slate-500">
            Loading attached files…
          </p>
        )}

        {filesQuery.error && (
          <p role="alert" className="py-4 text-center text-xs font-semibold text-rose-600">
            This lead’s attachments could not be loaded.
          </p>
        )}

        {!filesQuery.isPending && !filesQuery.error && files.length === 0 && (
          <p className="py-8 text-center text-xs text-slate-500">
            Nothing is attached to this lead yet.
          </p>
        )}

        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {files.map((file) => (
            <FileCard
              key={file.id}
              leadId={leadId}
              file={file}
              canWrite={canWrite}
              deleting={remove.isPending}
              onDelete={() => remove.mutate(file.id)}
              onPreview={() => setPreviewFile(file)}
            />
          ))}
        </ul>
      </div>

      {previewFile && (
        <FilePreviewModal
          leadId={leadId}
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </section>
  );
}

function FileCard({
  leadId,
  file,
  canWrite,
  deleting,
  onDelete,
  onPreview,
}: {
  leadId: string;
  file: LeadAttachmentResponse;
  canWrite: boolean;
  deleting: boolean;
  onDelete: () => void;
  onPreview: () => void;
}) {
  const isImage = file.mimeType.startsWith('image/');
  const { url: thumbnail } = useAttachmentUrl(leadId, file.id, isImage);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Saving a file is a fetch, not a link.
   */
  async function save() {
    setSaving(true);
    setFailed(false);
    try {
      const blob = await api.getBlob(LEAD_PATHS.fileDownload(leadId, file.id));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="group relative flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 transition hover:border-teal-300 hover:bg-slate-50 shadow-2xs">
      <div
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-3"
        onClick={onPreview}
      >
        {thumbnail ? (
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200 group-hover:ring-teal-400">
            <img
              src={thumbnail}
              alt={file.filename}
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition group-hover:opacity-100">
              <span className="text-white text-xs">🔍</span>
            </div>
          </div>
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 ring-1 ring-slate-200 text-2xl group-hover:bg-teal-50">
            {file.mimeType.includes('pdf') ? '📄' : isImage ? '🖼️' : '📎'}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p
            className="truncate text-xs font-bold text-slate-900 group-hover:text-teal-700 transition"
            title={file.filename}
          >
            {file.filename}
          </p>
          {failed && (
            <p role="alert" className="text-[11px] font-semibold text-rose-600">
              That file could not be downloaded.
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span className="font-medium text-slate-600">{describeType(file.mimeType)}</span>
            <span aria-hidden="true">·</span>
            <span>{describeSize(file.sizeBytes)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {new Date(file.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onPreview}
          aria-label={`Preview ${file.filename}`}
          title="Preview"
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 transition hover:bg-teal-50 hover:text-teal-800 hover:border-teal-200 cursor-pointer"
        >
          👁️ Preview
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          aria-label={`Download ${file.filename}`}
          title="Download"
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
        >
          {saving ? '…' : '⬇️ Download'}
        </button>
        {canWrite && (
          <button
            type="button"
            disabled={deleting}
            onClick={onDelete}
            aria-label={`Remove ${file.filename}`}
            title="Delete"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
          >
            <span aria-hidden="true">🗑️</span>
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * File Preview Modal (Lightbox) with zoom and direct download.
 */
function FilePreviewModal({
  leadId,
  file,
  onClose,
}: {
  leadId: string;
  file: LeadAttachmentResponse;
  onClose: () => void;
}) {
  const isImage = file.mimeType.startsWith('image/');
  const isPdf = file.mimeType.includes('pdf');
  const { url: fileUrl, isLoading, isError, retry } = useAttachmentUrl(leadId, file.id, true);
  const [zoom, setZoom] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await api.getBlob(LEAD_PATHS.fileDownload(leadId, file.id));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setDownloadError('Could not download file. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  function handleZoomIn() {
    setZoom((z) => Math.min(z + 0.25, 3));
  }

  function handleZoomOut() {
    setZoom((z) => Math.max(z - 0.25, 0.5));
  }

  function handleResetZoom() {
    setZoom(1);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${file.filename}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-xs p-4 sm:p-6 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-xl">
              {isPdf ? '📄' : isImage ? '🖼️' : '📎'}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold text-slate-900" title={file.filename}>
                {file.filename}
              </h2>
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="font-semibold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                  {describeType(file.mimeType)}
                </span>
                <span>·</span>
                <span>{describeSize(file.sizeBytes)}</span>
                <span>·</span>
                <span>Uploaded by {file.uploadedBy || 'Team'}</span>
                <span>·</span>
                <span>{new Date(file.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isImage && fileUrl && !isError && (
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  title="Zoom out"
                  aria-label="Zoom out"
                  className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={handleResetZoom}
                  title="Reset zoom"
                  aria-label="Reset zoom"
                  className="px-1.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  title="Zoom in"
                  aria-label="Zoom in"
                  className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                >
                  +
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={downloading}
              onClick={() => void handleDownload()}
              className="flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
            >
              <span>⬇️</span>
              <span>{downloading ? 'Downloading…' : 'Download'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow-2xs transition hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {downloadError && (
          <div className="flex items-center justify-between border-b border-rose-200 bg-rose-50 px-5 py-2 text-xs font-semibold text-rose-700">
            <span>⚠️ {downloadError}</span>
            <button
              type="button"
              onClick={() => setDownloadError(null)}
              className="text-rose-500 hover:text-rose-800 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Preview Content Area */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-900/5 p-6">
          {isImage && fileUrl && !isError && (
            <div className="flex items-center justify-center transition-transform duration-100 ease-out" style={{ transform: `scale(${zoom})` }}>
              <img
                src={fileUrl}
                alt={file.filename}
                className="max-h-[72vh] max-w-full rounded-lg object-contain shadow-md ring-1 ring-slate-200/50"
              />
            </div>
          )}

          {isImage && isLoading && (
            <div className="flex flex-col items-center gap-2 text-slate-500">
              <span className="text-3xl animate-pulse">🖼️</span>
              <p className="text-xs font-semibold">Loading screenshot preview…</p>
            </div>
          )}

          {isImage && !isLoading && isError && (
            <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
              <span className="text-4xl text-amber-500">🖼️</span>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{file.filename}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {describeType(file.mimeType)} · {describeSize(file.sizeBytes)}
                </p>
              </div>
              <p className="text-xs text-slate-600">
                Preview could not be displayed.
              </p>
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  ↻ Retry Preview
                </button>
                <button
                  type="button"
                  disabled={downloading}
                  onClick={() => void handleDownload()}
                  className="flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-teal-800 cursor-pointer"
                >
                  <span>⬇️</span> Download File
                </button>
              </div>
            </div>
          )}

          {isPdf && fileUrl && !isError && (
            <iframe
              src={fileUrl}
              title={file.filename}
              className="h-full w-full min-h-[65vh] rounded-lg border border-slate-200 bg-white shadow-xs"
            />
          )}

          {isPdf && isLoading && (
            <div className="flex flex-col items-center gap-2 text-slate-500">
              <span className="text-3xl animate-pulse">📄</span>
              <p className="text-xs font-semibold">Loading PDF document…</p>
            </div>
          )}

          {isPdf && !isLoading && isError && (
            <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
              <span className="text-4xl text-amber-500">📄</span>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{file.filename}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {describeType(file.mimeType)} · {describeSize(file.sizeBytes)}
                </p>
              </div>
              <p className="text-xs text-slate-600">
                PDF preview could not be displayed.
              </p>
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  ↻ Retry Preview
                </button>
                <button
                  type="button"
                  disabled={downloading}
                  onClick={() => void handleDownload()}
                  className="flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-teal-800 cursor-pointer"
                >
                  <span>⬇️</span> Download File
                </button>
              </div>
            </div>
          )}

          {!isImage && !isPdf && (
            <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
              <span className="text-4xl">📁</span>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{file.filename}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {describeType(file.mimeType)} · {describeSize(file.sizeBytes)}
                </p>
              </div>
              <p className="text-xs text-slate-600">
                This file format does not support inline preview in browser.
              </p>
              <button
                type="button"
                disabled={downloading}
                onClick={() => void handleDownload()}
                className="mt-2 flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-bold text-white shadow-2xs transition hover:bg-teal-800 cursor-pointer"
              >
                <span>⬇️</span> Download and view
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * An object URL for an image or PDF attachment, so it is previewable and recognisable.
 */
function useAttachmentUrl(
  leadId: string,
  fileId: string,
  enabled: boolean,
): { url: string | undefined; isLoading: boolean; isError: boolean; retry: () => void } {
  const [url, setUrl] = useState<string>();
  const [isLoading, setIsLoading] = useState(enabled);
  const [isError, setIsError] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      setIsError(false);
      return;
    }
    let objectUrl: string | undefined;
    let cancelled = false;
    setIsLoading(true);
    setIsError(false);

    void api
      .getBlob(LEAD_PATHS.fileDownload(leadId, fileId))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setIsLoading(false);
        setIsError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoading(false);
        setIsError(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [leadId, fileId, enabled, version]);

  return {
    url,
    isLoading,
    isError,
    retry: () => setVersion((v) => v + 1),
  };
}

function describeSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function describeType(mimeType: string): string {
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.startsWith('image/')) return mimeType.slice('image/'.length).toUpperCase();
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'Spreadsheet';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'Document';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'Slides';
  if (mimeType.startsWith('text/')) return 'Text';
  return 'File';
}

