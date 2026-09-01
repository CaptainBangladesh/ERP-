import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LEAD_PATHS, type LeadAttachmentListResponse, type LeadAttachmentResponse } from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';

/**
 * The Files tab: browse and open what is actually attached to a lead.
 *
 * The find-it tab for an artifact, so a salesperson can reach a quote without scrolling the
 * whole Timeline. Every upload is a real multipart upload and every file listed here can be
 * opened — a name with no bytes behind it is the failure this tab exists to have fixed.
 */

interface LeadFilesTabProps {
  leadId: string;
  canWrite: boolean;
}

export function LeadFilesTab({ leadId, canWrite }: LeadFilesTabProps) {
  const queryClient = useQueryClient();
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

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
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
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
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function FileCard({
  leadId,
  file,
  canWrite,
  deleting,
  onDelete,
}: {
  leadId: string;
  file: LeadAttachmentResponse;
  canWrite: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const isImage = file.mimeType.startsWith('image/');
  const thumbnail = useAttachmentUrl(leadId, file.id, isImage);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Saving a file is a fetch, not a link.
   *
   * The download endpoint needs the session header every other request carries, and an `<a>`
   * pointed at it would arrive anonymous. So the bytes are fetched, handed to the browser as
   * an object URL, and the URL is released once it has been used.
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
      // In the document, not detached: Firefox ignores `download` on an anchor that is not,
      // and a click on a detached element is a click nothing else in the page can react to.
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // Said on the card rather than thrown away: a button that does nothing when clicked is
      // indistinguishable from a file that is gone.
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 transition hover:border-slate-300">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={file.filename}
            className="h-10 w-10 shrink-0 rounded object-cover ring-1 ring-slate-200"
          />
        ) : (
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-2xl">
            {file.mimeType.includes('pdf') ? '📄' : isImage ? '🖼️' : '📎'}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-slate-900" title={file.filename}>
            {file.filename}
          </p>
          {failed && (
            <p role="alert" className="text-[11px] font-semibold text-rose-600">
              That file could not be downloaded.
            </p>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span>{describeType(file.mimeType)}</span>
            <span aria-hidden="true">·</span>
            <span>{describeSize(file.sizeBytes)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {new Date(file.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          aria-label={`Download ${file.filename}`}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {saving ? '…' : 'Download'}
        </button>
        {canWrite && (
          <button
            type="button"
            disabled={deleting}
            onClick={onDelete}
            aria-label={`Remove ${file.filename}`}
            className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
          >
            <span aria-hidden="true">🗑️</span>
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * An object URL for an image attachment, so a screenshot is recognisable without opening it.
 *
 * Only for images, and revoked when the card goes away: object URLs are held by the document
 * until they are released, so a worklist walked lead-to-lead would otherwise accumulate every
 * thumbnail it had ever drawn.
 */
function useAttachmentUrl(leadId: string, fileId: string, enabled: boolean): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!enabled) return;
    let objectUrl: string | undefined;
    let cancelled = false;

    void api
      .getBlob(LEAD_PATHS.fileDownload(leadId, fileId))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        // A thumbnail that cannot be fetched falls back to the icon; the card still works.
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [leadId, fileId, enabled]);

  return url;
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
