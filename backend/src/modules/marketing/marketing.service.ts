import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MARKETING_ERROR_CODES,
  type MarketingListResponse,
  type MarketingResponse,
  type MarketingStatus,
  type MarketingSummary,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { defined } from '../../prisma/columns';
import { CreateMarketingBody, MARKETING_LIST, UpdateMarketingBody } from './schemas';

/**
 * What marketing actually does.
 *
 * Two things in here are the platform's rather than this module's, and both look like
 * omissions until you know why:
 *
 * - **There is no company filter anywhere.** Scoping is applied to every query below by the
 *   tenancy extension, so another company's rows are not reachable from this file even by
 *   trying. A module that wrote the filter would be a module that could forget it.
 * - **Nothing is deleted.** Deactivating keeps whatever refers to a record intelligible; a
 *   delete would leave it naming an identifier that resolves to nothing.
 */
@Injectable()
export class MarketingService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async createMarketing(
    input: Valid<typeof CreateMarketingBody>,
  ): Promise<MarketingResponse> {
    const marketing = await this.prisma.marketing.create({
      data: companyApplied<Prisma.MarketingUncheckedCreateInput>({ name: input.name }),
    });

    return describe(marketing);
  }

  async listMarketings(query: Record<string, unknown>): Promise<MarketingListResponse> {
    const slice = listQuery(query, MARKETING_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.marketing.findMany(slice.findMany<Prisma.MarketingFindManyArgs>()),
      this.prisma.marketing.count(slice.count<Prisma.MarketingCountArgs>()),
    ]);

    return slice.respond(rows.map(describe), total);
  }

  async marketingDetail(id: string): Promise<MarketingResponse> {
    const marketing = await this.prisma.marketing.findFirst({ where: { id } });
    if (!marketing) throw notFound();

    return describe(marketing);
  }

  /**
   * Changes a record, or deactivates it.
   *
   * Deactivation is a status rather than an endpoint of its own, because it is the same act
   * as any other correction from the caller's point of view and the same write from the
   * database's.
   */
  async changeMarketing(
    id: string,
    input: Valid<typeof UpdateMarketingBody>,
  ): Promise<MarketingResponse> {
    await this.marketingDetail(id);

    const marketing = await this.prisma.marketing.update({
      where: { id },
      data: { ...defined('name', input.name), ...defined('status', input.status) },
    });

    return describe(marketing);
  }
}

function describe(row: { id: string; name: string; status: string }): MarketingSummary {
  return {
    id: row.id,
    name: row.name,
    // The column is text rather than a Postgres enum, so the wire type is asserted here, at
    // the one boundary where the two representations meet.
    status: row.status as MarketingStatus,
  };
}

/**
 * The same 404 a record in another company gets, deliberately. Telling a caller that an
 * identifier is real but not theirs would turn the endpoint into a way of counting somebody
 * else's rows.
 */
function notFound(): ApiException {
  return new ApiException(
    MARKETING_ERROR_CODES.marketingNotFound,
    'That marketing does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
