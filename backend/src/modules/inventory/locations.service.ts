import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LOCATION_ERROR_CODES,
  type LocationListResponse,
  type LocationResponse,
  type LocationStatus,
  type LocationSummary,
} from '@erp/shared';
import type { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { defined } from '../../prisma/columns';
import {
  locationCodeTaken,
  locationHoldsStock,
  locationNotFound,
  refuseDuplicate,
} from './refusals';
import { CreateLocationBody, LOCATION_LIST, UpdateLocationBody } from './schemas';

/**
 * Where this company keeps things.
 *
 * Three rules are the whole of it, and each of them is a decision rather than a default:
 *
 * - **A code is unique within a company and means nothing across companies.** Two businesses
 *   both calling somewhere `WH-1` is not a collision; a global constraint would make one of
 *   them rename their warehouse because of somebody they have never met.
 * - **Nothing is deleted.** A location that has closed appears in every movement ever recorded
 *   against it, and a delete would leave each of them naming an identifier that resolves to
 *   nothing. Deactivation says "we do not put things here any more", and it is reversible.
 * - **Somewhere holding stock cannot go quiet.** Deactivating it would strand what is in it —
 *   present in the ledger, absent from every screen that offers a place to move stock to.
 *
 * As in every module, there is no company filter in this file: the platform scopes every query
 * below, so another company's locations are not reachable from here even by trying.
 */
@Injectable()
export class LocationsService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async createLocation(input: Valid<typeof CreateLocationBody>): Promise<LocationResponse> {
    const location = await this.prisma.location
      .create({
        data: companyApplied<Prisma.LocationUncheckedCreateInput>({
          code: input.code,
          name: input.name,
        }),
      })
      .catch(duplicate(input.code));

    return summarise(location);
  }

  async listLocations(query: Record<string, unknown>): Promise<LocationListResponse> {
    const slice = listQuery(query, LOCATION_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.location.findMany(slice.findMany<Prisma.LocationFindManyArgs>()),
      this.prisma.location.count(slice.count<Prisma.LocationCountArgs>()),
    ]);

    return slice.respond(rows.map(summarise), total);
  }

  async locationDetail(id: string): Promise<LocationResponse> {
    const location = await this.prisma.location.findFirst({ where: { id } });
    if (!location) throw locationNotFound();

    return summarise(location);
  }

  /**
   * Corrects a location, deactivates it, or brings it back.
   *
   * Deactivation is a status rather than an endpoint of its own, because it is the same act as
   * any other correction from the caller's point of view and the same write from the
   * database's. The one thing that makes it different is the check below — and reactivation
   * deliberately has no equivalent, because bringing somewhere back into use cannot strand
   * anything.
   */
  async changeLocation(
    id: string,
    input: Valid<typeof UpdateLocationBody>,
  ): Promise<LocationResponse> {
    const existing = await this.locationDetail(id);

    if (input.status === 'inactive') {
      const held = await this.productsHeldAt(id);
      if (held > 0) throw locationHoldsStock(held);
    }

    const location = await this.prisma.location
      .update({
        where: { id },
        data: {
          ...defined('code', input.code),
          ...defined('name', input.name),
          ...defined('status', input.status),
        },
      })
      // The code that could collide is the new one when there is one, and otherwise the one
      // the row already has. A constraint cannot fire on a code nobody changed, so the second
      // case is unreachable — but reaching for `''` to fill the gap would put an empty pair of
      // quotes in a sentence somebody reads, on the day it turns out to be reachable after all.
      .catch(duplicate(input.code ?? existing.code, locationNotFound));

    return summarise(location);
  }

  /**
   * How many distinct products are still held here.
   *
   * Zero for every location today, and that is a fact about the schema rather than a stub with
   * optimism in it: the stock a movement leaves behind arrives in ticket 09, and until
   * something can put stock into a location, nothing can be holding any. When the ledger
   * exists this becomes a count over it, and nothing above changes.
   *
   * The rule lives here rather than travelling with the ledger because it belongs to
   * deactivation: the refusal is part of what "deactivate a location" means, and a client
   * learning about `location_holds_stock` the week movements ship would be a client whose
   * error handling was complete and then quietly was not.
   */
  private async productsHeldAt(_locationId: string): Promise<number> {
    return 0;
  }
}

/**
 * The unique constraint on `(company_id, code)`, as a message beside the input that caused it.
 *
 * `gone` is passed only by the update, where Prisma's `P2025` means the row disappeared between
 * the read above and the write — the caller should get the 404 it would have had a moment
 * earlier. A create cannot produce one, so it does not pretend to handle it.
 */
function duplicate(code: string, gone?: () => ApiException) {
  return refuseDuplicate(
    LOCATION_ERROR_CODES.duplicateLocationCode,
    'code',
    locationCodeTaken(code),
    gone,
  );
}

function summarise(row: {
  id: string;
  code: string;
  name: string;
  status: string;
}): LocationSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    // The column is text rather than a Postgres enum — see schema.prisma — so the wire type is
    // asserted here, at the one boundary where the two representations meet.
    status: row.status as LocationStatus,
  };
}
