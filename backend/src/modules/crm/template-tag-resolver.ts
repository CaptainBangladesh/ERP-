import { HttpStatus } from '@nestjs/common';
import { EMAIL_TEMPLATE_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';

export const ALLOWED_LEAD_TAG_KEYS = new Set([
  'name',
  'email',
  'organisationName',
  'phone',
  'status',
]);

export const ALLOWED_SENDER_TAG_KEYS = new Set([
  'displayName',
  'emailAddress',
]);

export interface TemplateTag {
  raw: string;
  namespace: string;
  field: string;
  fallback?: string;
}

export function parseTemplateTags(templateText: string): TemplateTag[] {
  const tagRegex = /\{\{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)(?:\|([^}]+))?\s*\}\}/g;
  const tags: TemplateTag[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(templateText)) !== null) {
    if (match[1] && match[2]) {
      tags.push({
        raw: match[0],
        namespace: match[1],
        field: match[2],
        fallback: match[3] !== undefined ? match[3].trim() : undefined,
      });
    }
  }

  return tags;
}

export function validateTemplateTags(
  templateText: string,
  activeCustomFieldKeys: Set<string>,
): void {
  const tags = parseTemplateTags(templateText);

  for (const tag of tags) {
    if (tag.namespace === 'lead') {
      if (!ALLOWED_LEAD_TAG_KEYS.has(tag.field)) {
        throw invalidTemplateTags(`Unknown field 'lead.${tag.field}'.`);
      }
    } else if (tag.namespace === 'sender') {
      if (!ALLOWED_SENDER_TAG_KEYS.has(tag.field)) {
        throw invalidTemplateTags(`Unknown field 'sender.${tag.field}'.`);
      }
    } else if (tag.namespace === 'custom') {
      if (!activeCustomFieldKeys.has(tag.field)) {
        throw invalidTemplateTags(`Unknown custom field key 'custom.${tag.field}'.`);
      }
    } else {
      throw invalidTemplateTags(`Unknown tag namespace '${tag.namespace}'.`);
    }
  }
}

export interface TagResolutionContext {
  lead?: {
    name?: string | null;
    email?: string | null;
    organisationName?: string | null;
    phone?: string | null;
    status?: string | null;
  };
  custom?: Record<string, unknown>;
  sender?: {
    displayName?: string | null;
    emailAddress?: string | null;
  };
}

export function resolveTemplate(
  templateText: string,
  context: TagResolutionContext,
): string {
  const tagRegex = /\{\{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)(?:\|([^}]+))?\s*\}\}/g;

  return templateText.replace(tagRegex, (_match, namespace, field, fallbackRaw) => {
    const fallback = fallbackRaw !== undefined ? fallbackRaw.trim() : '';
    let resolvedValue: unknown;

    if (namespace === 'lead' && context.lead) {
      resolvedValue = (context.lead as Record<string, unknown>)[field];
    } else if (namespace === 'sender' && context.sender) {
      resolvedValue = (context.sender as Record<string, unknown>)[field];
    } else if (namespace === 'custom' && context.custom) {
      resolvedValue = context.custom[field];
    }

    if (resolvedValue !== undefined && resolvedValue !== null && String(resolvedValue).trim() !== '') {
      return String(resolvedValue).trim();
    }

    return fallback;
  });
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function invalidTemplateTags(message: string): ApiException {
  return new ApiException(
    EMAIL_TEMPLATE_ERROR_CODES.invalidTemplateTags,
    `Invalid template tags: ${message}`,
    HttpStatus.BAD_REQUEST,
  );
}
