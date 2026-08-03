import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Decimal,
  PRODUCT_ERROR_CODES,
  QUANTITY_SCALE,
  Quantity,
  type CatalogueStatus,
  type UnitGroupsResponse,
  type UnitListResponse,
  type UnitSummary,
} from '@erp/shared';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { defined, exactly } from '../../prisma/columns';
import {
  groupNameTaken,
  noSuchGroup,
  ratioWithoutGroup,
  refuseDuplicate,
  unitCodeTaken,
  unitInUse,
  unitNotFound,
  unitsDoNotConvert,
} from './refusals';
import { CreateUnitBody, CreateUnitGroupBody, UNIT_LIST, UpdateUnitBody } from './schemas';

/**
 * Units of measure, and the groups that make converting between them meaningful.
 *
 * Three decisions are the whole of this file:
 *
 * - **Nothing is seeded, here least of all.** A business dealing in metres and one dealing in
 *   pallets should not both begin with a list somebody else guessed at, and a seeded unit is a
 *   row nobody chose that every later movement is measured in.
 * - **A group is what makes conversion refusable.** Kilograms and grams convert because
 *   somebody said they measure the same thing; kilograms and hours do not, because nobody
 *   could. Without groups the only options are converting everything or converting nothing,
 *   and the first is worse.
 * - **The base unit is the one whose ratio is 1**, and there is no column saying which it is.
 *   Converting is `amount × from.ratio ÷ to.ratio`, which never names the base — so there is
 *   nothing for a pointer to disagree with.
 */
@Injectable()
export class UnitsService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  // ─── groups ───────────────────────────────────────────────────────────────────────

  async createGroup(input: Valid<typeof CreateUnitGroupBody>): Promise<UnitGroupsResponse> {
    await this.prisma.unitGroup
      .create({ data: companyApplied<Prisma.UnitGroupUncheckedCreateInput>({ name: input.name }) })
      .catch(
        refuseDuplicate(
          PRODUCT_ERROR_CODES.duplicateUnitGroup,
          'name',
          groupNameTaken(input.name),
        ),
      );

    return this.groups();
  }

  /**
   * Every group with its units, smallest first.
   *
   * The whole answer rather than a page of it: a company has a handful of groups holding a
   * handful of units each, and what the screen shows is the *structure* — which units convert
   * to which — which a page boundary drawn through it would cut in half.
   */
  async groups(): Promise<UnitGroupsResponse> {
    const groups = await this.prisma.unitGroup.findMany({
      include: { units: { orderBy: [{ ratio: 'asc' }, { code: 'asc' }] } },
      orderBy: { name: 'asc' },
    });

    return {
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        units: group.units.map((unit) => describeUnit(unit, group.name)),
      })),
    };
  }

  // ─── units ────────────────────────────────────────────────────────────────────────

  async createUnit(input: Valid<typeof CreateUnitBody>): Promise<UnitSummary> {
    if (input.groupId) await this.requireGroup(input.groupId);

    const unit = await this.prisma.unitOfMeasure
      .create({
        data: companyApplied<Prisma.UnitOfMeasureUncheckedCreateInput>({
          code: input.code,
          name: input.name,
          groupId: input.groupId ?? null,
          // Absent is 1 — a unit that converts to nothing but itself, which is also what a
          // group's base unit is.
          ratio: (input.ratio ?? Decimal.ONE).toString(),
        }),
      })
      .catch(
        refuseDuplicate(
          PRODUCT_ERROR_CODES.duplicateUnitCode,
          'code',
          unitCodeTaken(input.code),
        ),
      );

    return this.unitDetail(unit.id);
  }

  async listUnits(query: Record<string, unknown>): Promise<UnitListResponse> {
    const slice = listQuery(query, UNIT_LIST);

    const [units, total] = await Promise.all([
      this.prisma.unitOfMeasure.findMany({
        ...slice.findMany<Prisma.UnitOfMeasureFindManyArgs>(),
        include: GROUP,
      }),
      this.prisma.unitOfMeasure.count(slice.count<Prisma.UnitOfMeasureCountArgs>()),
    ]);

    return slice.respond(units.map(summariseUnit), total);
  }

  async unitDetail(id: string): Promise<UnitSummary> {
    const unit = await this.prisma.unitOfMeasure.findFirst({ where: { id }, include: GROUP });
    if (!unit) throw unitNotFound();

    return summariseUnit(unit);
  }

  /**
   * Changes a unit, or deactivates it.
   *
   * Two refusals live here rather than in the validator, because both are questions about the
   * stored row that a request body cannot answer on its own:
   *
   * - **A unit that active products are measured in cannot be deactivated.** The alternative —
   *   letting it go inactive and leaving the products pointing at it — produces a catalogue
   *   measured in something the unit screen says is not in use, which is a state nobody can
   *   act on. Deactivating those products *does* clear the way, which is what the message
   *   tells you to do.
   * - **A ratio only means something inside a group.** `CreateUnitBody` refuses the same
   *   combination; without this, a `PATCH` would be a way round it, and the group a unit is in
   *   may be the one already stored rather than one in this request.
   */
  async changeUnit(id: string, input: Valid<typeof UpdateUnitBody>): Promise<UnitSummary> {
    const existing = await this.requireUnit(id);

    if (input.groupId) await this.requireGroup(input.groupId);

    const group = input.groupId ?? existing.groupId;
    if (input.ratio && !group && !input.ratio.equals(Decimal.ONE)) throw ratioWithoutGroup();

    if (input.status === 'inactive' && existing.status === 'active') {
      const measured = await this.prisma.product.count({
        where: { unitId: id, status: 'active' },
      });
      if (measured > 0) throw unitInUse(measured);
    }

    // No duplicate to catch: nothing here changes the code, which is the only thing a unique
    // constraint covers.
    await this.prisma.unitOfMeasure.update({
      where: { id },
      data: {
        ...defined('name', input.name),
        ...defined('status', input.status),
        ...defined('groupId', input.groupId),
        ...defined('ratio', input.ratio?.toString()),
      },
    });

    return this.unitDetail(id);
  }

  // ─── conversion ───────────────────────────────────────────────────────────────────

  /**
   * The same amount, measured in a different unit.
   *
   * `amount × from.ratio ÷ to.ratio`, with the division rounded because division cannot be
   * exact — half-even, as everywhere in this codebase, because it is the only mode that does
   * not accumulate a bias over a long sequence of values, which is exactly what a stock ledger
   * is.
   *
   * Refuses two units that do not measure the same thing, rather than answering. That refusal
   * is the reason groups exist at all: converting kilograms to hours has no answer, and one
   * invented here would surface three modules away as a stock figure nobody can explain.
   */
  async convert(amount: Quantity, fromUnitId: string, toUnitId: string): Promise<Quantity> {
    if (fromUnitId === toUnitId) return amount;

    const units = await this.prisma.unitOfMeasure.findMany({
      where: { id: { in: [fromUnitId, toUnitId] } },
    });

    const from = units.find((unit) => unit.id === fromUnitId);
    const to = units.find((unit) => unit.id === toUnitId);
    if (!from || !to) throw unitNotFound();

    if (!from.groupId || from.groupId !== to.groupId) {
      throw unitsDoNotConvert(from.code, to.code);
    }

    return (
      amount
        .times(Decimal.parse(exactly(from.ratio)))
        .dividedBy(Decimal.parse(exactly(to.ratio)), {
          scale: QUANTITY_SCALE,
          rounding: 'half-even',
        })
        // Trailing zeros trimmed, because the scale of the answer is an artifact of the
        // division rather than a fact about the measurement: 2.5 kilograms is 2500 grams, and
        // `2500.000000` is six digits of precision nobody has.
        .trimmed()
    );
  }

  // ─── internals ────────────────────────────────────────────────────────────────────

  /** The unit, if this company has one. Used by products before it measures anything in it. */
  async requireUnit(id: string) {
    const unit = await this.prisma.unitOfMeasure.findFirst({ where: { id } });
    if (!unit) throw unitNotFound();
    return unit;
  }

  private async requireGroup(id: string): Promise<void> {
    const group = await this.prisma.unitGroup.findFirst({ where: { id } });
    if (!group) throw noSuchGroup();
  }
}

/** The group's name, for a unit to report without a second query per row. */
const GROUP = { group: { select: { name: true } } } satisfies Prisma.UnitOfMeasureInclude;

type UnitRow = Prisma.UnitOfMeasureGetPayload<{ include: typeof GROUP }>;

function summariseUnit(unit: UnitRow): UnitSummary {
  return describeUnit(unit, unit.group?.name ?? null);
}

/**
 * A unit as it goes out.
 *
 * The ratio crosses the wire as decimal text, never as a JSON number: it is the value every
 * conversion divides by, and a double would round the definition of an ounce before anybody
 * had used it. Trailing zeros are dropped, so the `1` somebody typed does not come back as
 * `1.000000000000`.
 */
function describeUnit(
  unit: {
    id: string;
    code: string;
    name: string;
    status: string;
    groupId: string | null;
    ratio: Prisma.Decimal;
  },
  groupName: string | null,
): UnitSummary {
  return {
    id: unit.id,
    code: unit.code,
    name: unit.name,
    status: unit.status as CatalogueStatus,
    groupId: unit.groupId,
    groupName,
    ratio: Quantity.parse(exactly(unit.ratio)).trimmed().toValue(),
  };
}
