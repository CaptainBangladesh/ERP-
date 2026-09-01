import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../../http/api-exception';

export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export interface UploadOptions {
  maxSizeBytes?: number;
  allowedExtensions?: readonly string[];
  allowedMimeTypes?: readonly string[];
  /**
   * What to tell someone whose file was the wrong kind. Defaults to the spreadsheet wording
   * the import screens want; an allowlist that is not spreadsheets needs its own sentence, or
   * the refusal names a format the caller was never being asked for.
   */
  rejectionMessage?: string;
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const SPREADSHEET_UPLOAD_OPTIONS: UploadOptions = {
  maxSizeBytes: 5 * 1024 * 1024, // 5MB
  allowedExtensions: ['.csv', '.xlsx', '.xls'],
  allowedMimeTypes: [
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
  ],
};

/**
 * What a salesperson attaches to a lead: a quote, a proposal, a photo of the customer's lot.
 *
 * Wider than the spreadsheet allowlist and capped higher, because the point of the Files tab is
 * that a real document can live on the lead. Executables and archives are left off deliberately
 * — an attachment is something to read, and the store hands bytes straight back to a browser.
 *
 * SVG is left off for the same reason and is worth naming, because it looks like an image and
 * is not: it can carry script, and the download endpoint serves attachments `inline` from the
 * application's own origin, which would make an uploaded SVG a script running as the signed-in
 * user. Raster formats cannot do that.
 */
export const ATTACHMENT_UPLOAD_OPTIONS: UploadOptions = {
  maxSizeBytes: 25 * 1024 * 1024, // 25MB
  allowedExtensions: [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.csv', '.txt', '.md',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic',
  ],
  allowedMimeTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'text/csv',
    'text/plain',
    'text/markdown',
    'image/',
  ],
  rejectionMessage:
    'That file type cannot be attached. Attach a document, spreadsheet, presentation or image.',
};

/**
 * Reusable platform capability for validating in-memory multipart uploads.
 *
 * Checks file size caps and content-type allowlists before any parsing is attempted.
 * Refuses non-matching files with a clear `ApiException`. The uploaded file buffer is
 * parsed in-memory per-request and is never persisted.
 */
export function validateUploadedFile(
  file: UploadedFile | undefined,
  options: UploadOptions = SPREADSHEET_UPLOAD_OPTIONS,
): UploadedFile {
  if (!file || !file.buffer) {
    throw new ApiException('missing_file', 'No file was uploaded.', HttpStatus.BAD_REQUEST);
  }

  const maxSize = options.maxSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
  if (file.size > maxSize || file.buffer.length > maxSize) {
    const maxMb = Math.round(maxSize / (1024 * 1024));
    throw new ApiException(
      'file_too_large',
      `Uploaded file is too large. Maximum allowed size is ${maxMb}MB.`,
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }

  const filename = (file.originalname || '').toLowerCase();
  const mimetype = (file.mimetype || '').toLowerCase();

  const extensionAllowed = options.allowedExtensions?.some((ext) => filename.endsWith(ext));
  const mimeAllowed = options.allowedMimeTypes?.some((type) => mimetype.includes(type));

  if (!extensionAllowed && !mimeAllowed) {
    throw new ApiException(
      'invalid_file_type',
      options.rejectionMessage ?? 'File must be a CSV or XLSX spreadsheet.',
      HttpStatus.BAD_REQUEST,
    );
  }

  return file;
}
