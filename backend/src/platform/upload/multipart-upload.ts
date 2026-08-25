import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../../http/api-exception';

export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export interface UploadOptions {
  maxSizeBytes?: number;
  allowedExtensions?: readonly string[];
  allowedMimeTypes?: readonly string[];
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
      'File must be a CSV or XLSX spreadsheet.',
      HttpStatus.BAD_REQUEST,
    );
  }

  return file;
}
