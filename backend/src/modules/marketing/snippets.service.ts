import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MARKETING_ERROR_CODES,
  type SnippetKind,
  type SnippetListResponse,
  type SnippetSummary,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { defined } from '../../prisma/columns';
import { CreateSnippetBody, SNIPPET_LIST, UpdateSnippetBody } from './schemas';

/**
 * What a new brand starts with, so the library is never an empty box.
 *
 * Plain text with the closed placeholder set (14o) and nothing else — no markup, no
 * expression syntax, nothing a template engine would evaluate, because there is no template
 * engine.
 */
export const STARTER_SNIPPETS: ReadonlyArray<{ kind: SnippetKind; label: string; body: string }> = [
  {
    kind: 'first_comment',
    label: 'Link in first comment',
    body: 'Full details here: {cta}',
  },
  {
    kind: 'first_comment',
    label: 'Ask for replies',
    body: 'Curious what you think — reply and tell us how you handle {subject}.',
  },
  {
    kind: 'cta',
    label: 'Book a call',
    body: 'Want {brand} to walk you through it? Book a 15-minute call: {cta}',
  },
  {
    kind: 'cta',
    label: 'Read the guide',
    body: 'We wrote the long version. Read the {subject} guide: {cta}',
  },
  {
    kind: 'cta',
    label: 'Save this',
    body: 'Save this for the next time {subject} comes up.',
  },
];

/**
 * The per-brand snippet library — saved first comments and calls to action.
 *
 * Rows carry text and only text. Nothing here interpolates a snippet body server-side, and
 * the composer inserts it as a `textarea` value; the placeholder substitution that does
 * happen is literal string replacement over a fixed key set, in the browser, with no engine
 * behind it (14o).
 */
@Injectable()
export class SnippetsService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async listSnippets(query: Record<string, unknown>): Promise<SnippetListResponse> {
    const slice = listQuery(query, SNIPPET_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.composerSnippet.findMany(slice.findMany<Prisma.ComposerSnippetFindManyArgs>()),
      this.prisma.composerSnippet.count(slice.count<Prisma.ComposerSnippetCountArgs>()),
    ]);

    return slice.respond(rows.map(describeSnippet), total);
  }

  async createSnippet(input: Valid<typeof CreateSnippetBody>): Promise<SnippetSummary> {
    await this.requireBrand(input.brandId);

    const row = await this.prisma.composerSnippet.create({
      data: companyApplied<Prisma.ComposerSnippetUncheckedCreateInput>({
        brandId: input.brandId,
        kind: input.kind,
        label: input.label,
        body: input.body,
      }),
    });

    return describeSnippet(row);
  }

  async updateSnippet(
    id: string,
    input: Valid<typeof UpdateSnippetBody>,
  ): Promise<SnippetSummary> {
    const existing = await this.prisma.composerSnippet.findFirst({ where: { id } });
    if (!existing) throw snippetNotFound();

    const row = await this.prisma.composerSnippet.update({
      where: { id: existing.id },
      data: { ...defined('label', input.label), ...defined('body', input.body) },
    });

    return describeSnippet(row);
  }

  async deleteSnippet(id: string): Promise<void> {
    const existing = await this.prisma.composerSnippet.findFirst({ where: { id } });
    if (!existing) throw snippetNotFound();

    await this.prisma.composerSnippet.delete({ where: { id: existing.id } });
  }

  /**
   * Fills a brand's library with the starter set, once.
   *
   * Idempotent by label, so calling it a second time — a restart, a second person opening the
   * composer — does not duplicate the set.
   */
  async seedStarterSnippets(brandId: string): Promise<SnippetSummary[]> {
    await this.requireBrand(brandId);

    const existing = await this.prisma.composerSnippet.findMany({
      where: { brandId },
      select: { label: true },
    });
    const have = new Set(existing.map((row) => row.label));

    const created: SnippetSummary[] = [];
    for (const starter of STARTER_SNIPPETS) {
      if (have.has(starter.label)) continue;
      const row = await this.prisma.composerSnippet.create({
        data: companyApplied<Prisma.ComposerSnippetUncheckedCreateInput>({
          brandId,
          kind: starter.kind,
          label: starter.label,
          body: starter.body,
        }),
      });
      created.push(describeSnippet(row));
    }

    return created;
  }

  private async requireBrand(brandId: string): Promise<void> {
    const brand = await this.prisma.marketingBrand.findFirst({ where: { id: brandId } });
    if (!brand) {
      throw new ApiException(
        MARKETING_ERROR_CODES.brandNotFound,
        'That brand does not exist.',
        HttpStatus.NOT_FOUND,
      );
    }
  }
}

function describeSnippet(row: {
  id: string;
  brandId: string;
  kind: string;
  label: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}): SnippetSummary {
  return {
    id: row.id,
    brandId: row.brandId,
    kind: row.kind as SnippetKind,
    label: row.label,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function snippetNotFound(): ApiException {
  return new ApiException(
    MARKETING_ERROR_CODES.snippetNotFound,
    'That snippet does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
