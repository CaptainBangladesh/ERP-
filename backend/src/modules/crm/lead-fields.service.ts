import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type LeadCustomValues,
  type LeadFieldListResponse,
  type LeadFieldResponse,
  type LeadFieldSummary,
  type LeadFieldType,
  type LeadFieldValue,
} from '@erp/shared';
import { defined } from '../../prisma/columns';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { invalidLeadFieldValues, leadFieldNotFound } from './refusals';
import { reposition } from './reposition';
import { CreateLeadFieldBody, UpdateLeadFieldBody } from './schemas';

/**
 * Fields a company defines on its Leads without a developer, and the one gate their values pass
 * through.
 *
 * Two decisions shape everything here. **Definitions are rows and values are one JSON column**
 * on the Lead, rather than an entity-attribute-value table: values are read and written whole,
 * always alongside their Lead, and never joined against. The stated cost is that custom fields
 * take no part in `ListSpec`'s sort/filter grammar — a JSON column has no static fields to
 * declare. Built-in columns do.
 *
 * **`key` is derived once and never rewritten.** A rename changes the label a person reads; the
 * key every stored value is filed under stays put. That is the difference between fixing a typo
 * and orphaning every value captured under the old spelling.
 *
 * `validate` below is the module's single answer to "is this a legal set of custom values". Every
 * write path that can set them calls it — manual create and update today, spreadsheet import and
 * public web-form capture when those land. One validator on purpose: a public door that was
 * more lenient than the form beside it is exactly the bug this shape prevents.
 */
@Injectable()
export class LeadFieldsService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async createLeadField(input: Valid<typeof CreateLeadFieldBody>): Promise<LeadFieldResponse> {
    const [highest, existing] = await Promise.all([
      this.prisma.leadFieldDefinition.findFirst({ orderBy: { order: 'desc' }, select: { order: true } }),
      this.prisma.leadFieldDefinition.findMany({ select: { key: true } }),
    ]);

    const definition = await this.prisma.leadFieldDefinition.create({
      data: companyApplied<Prisma.LeadFieldDefinitionUncheckedCreateInput>({
        key: keyFor(input.label, new Set(existing.map((row) => row.key))),
        label: input.label,
        type: input.type,
        options: input.options ?? [],
        required: input.required ?? false,
        order: (highest?.order ?? 0) + 1,
      }),
    });

    return describe(definition);
  }

  /**
   * Every definition in the company's own order. Archived ones are included but flagged, because
   * the lead screen still has to label values captured under them — hiding an archived field
   * from this list would leave those values rendering as bare keys.
   */
  async listLeadFields(): Promise<LeadFieldListResponse> {
    const rows = await this.prisma.leadFieldDefinition.findMany({ orderBy: { order: 'asc' } });
    const items = rows.map(describe);
    return {
      items,
      page: {
        number: 1,
        size: items.length || 25,
        total: items.length,
        pages: items.length > 0 ? 1 : 0,
      },
    };
  }

  async updateLeadField(
    id: string,
    input: Valid<typeof UpdateLeadFieldBody>,
  ): Promise<LeadFieldResponse> {
    const existing = await this.requireLeadField(id);

    const fields = {
      ...defined('label', input.label),
      ...defined('required', input.required),
      ...(input.options !== undefined ? { options: input.options } : {}),
    };

    const updated =
      input.order === undefined
        ? await this.prisma.leadFieldDefinition.update({ where: { id }, data: fields })
        : await reposition(
            this.prisma,
            (client) => client.leadFieldDefinition,
            id,
            existing.order,
            input.order,
            fields,
          );

    return describe(updated);
  }

  /**
   * Archive, never delete — its own endpoint rather than a flag on the general update, matching
   * this module's existing discipline for writes that mean something beyond setting a column.
   *
   * An archived field stops being offered and stops being required. Every value already captured
   * under its key stays on the Leads that hold it and still reads back, which is the entire point:
   * a company changing its mind about what to track must not destroy what it already tracked.
   */
  async archiveLeadField(id: string): Promise<LeadFieldResponse> {
    await this.requireLeadField(id);
    const archived = await this.prisma.leadFieldDefinition.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return describe(archived);
  }

  async restoreLeadField(id: string): Promise<LeadFieldResponse> {
    await this.requireLeadField(id);
    const restored = await this.prisma.leadFieldDefinition.update({
      where: { id },
      data: { archivedAt: null },
    });
    return describe(restored);
  }

  /**
   * The one gate custom values pass through, on every path that can set them.
   *
   * `submitted` is what the caller sent; `stored` is what the Lead already holds, absent on a
   * create. Values are *merged* rather than replaced — a key the caller did not mention keeps
   * whatever it had — so an edit screen showing three of a company's ten fields cannot silently
   * erase the other seven.
   *
   * Required-ness is checked against the merged result rather than the submission, for the same
   * reason: a required field already filled in is still filled in after an update that never
   * mentions it.
   *
   * Every complaint is collected before any is raised, so a form marks all of its bad inputs in
   * one round trip.
   */
  async validate(
    submitted: LeadCustomValues | undefined,
    stored: LeadCustomValues = {},
  ): Promise<LeadCustomValues> {
    const definitions = await this.prisma.leadFieldDefinition.findMany({
      orderBy: { order: 'asc' },
    });

    const live = definitions.filter((definition) => definition.archivedAt === null);
    const byKey = new Map(live.map((definition) => [definition.key, definition]));
    const problems: Record<string, string> = {};

    const merged: LeadCustomValues = { ...stored };

    for (const [key, value] of Object.entries(submitted ?? {})) {
      const definition = byKey.get(key);
      if (!definition) {
        // Covers both a key naming nothing and a key naming an archived field. Accepting a
        // write to an archived field would make "archived" mean "hidden but still writable",
        // which is not a state anybody asked for.
        problems[key] = `'${key}' is not a field on this company's leads.`;
        continue;
      }

      const read = readValue(definition.type as LeadFieldType, optionsOf(definition.options), value);
      if (!read.ok) {
        problems[key] = `${definition.label}: ${read.message}`;
        continue;
      }

      if (read.value === null) delete merged[key];
      else merged[key] = read.value;
    }

    for (const definition of live) {
      if (!definition.required) continue;
      if (isEmpty(merged[definition.key])) {
        problems[definition.key] = `${definition.label} is required.`;
      }
    }

    if (Object.keys(problems).length > 0) throw invalidLeadFieldValues(problems);

    return merged;
  }

  private async requireLeadField(id: string) {
    const definition = await this.prisma.leadFieldDefinition.findFirst({ where: { id } });
    if (!definition) throw leadFieldNotFound();
    return definition;
  }
}

/**
 * A stable key from a label: lowercase, words joined by underscores, anything else dropped.
 *
 * A label of nothing but punctuation, and a label colliding with a key already taken, both end
 * up suffixed rather than refused — this runs once at creation and the person naming the field
 * is thinking about the label, not about a key they will never see.
 */
function keyFor(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'field';

  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

type Read =
  | { ok: true; value: Exclude<LeadFieldValue, undefined> }
  | { ok: false; message: string };

/**
 * One value, against its definition's type. `null` is always accepted and means "clear it" —
 * the required check that runs afterwards is what decides whether clearing was allowed.
 */
function readValue(type: LeadFieldType, options: string[], value: unknown): Read {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };

  switch (type) {
    case 'text':
      if (typeof value !== 'string') return { ok: false, message: 'enter text.' };
      if (value.length > 2000) return { ok: false, message: 'use 2000 characters or fewer.' };
      return { ok: true, value };

    case 'number':
      // A JSON number, or the decimal text a form field actually submits. `Number` alone would
      // read '' as 0 and 'Infinity' as a number, so both are refused explicitly.
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) return { ok: false, message: 'enter a number.' };
        return { ok: true, value };
      }
      if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
        return { ok: true, value: Number(value.trim()) };
      }
      return { ok: false, message: 'enter a number.' };

    case 'date':
      // `YYYY-MM-DD` and nothing looser. "next Tuesday-ish" is the case this exists to refuse,
      // and so is `2026-02-31`, which passes the pattern but is not a day.
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { ok: false, message: 'enter a date, as YYYY-MM-DD.' };
      }
      if (!isRealDay(value)) return { ok: false, message: 'that is not a date on the calendar.' };
      return { ok: true, value };

    case 'boolean':
    case 'checkbox':
      if (typeof value !== 'boolean') return { ok: false, message: 'enter true or false.' };
      return { ok: true, value };

    case 'select':
      if (typeof value !== 'string') return { ok: false, message: 'choose one of the options.' };
      if (!options.includes(value)) {
        return { ok: false, message: `'${value}' is not one of the options.` };
      }
      return { ok: true, value };

    case 'multiselect': {
      if (!Array.isArray(value)) return { ok: false, message: 'choose from the options.' };
      const chosen: string[] = [];
      for (const entry of value) {
        if (typeof entry !== 'string' || !options.includes(entry)) {
          return { ok: false, message: `'${String(entry)}' is not one of the options.` };
        }
        if (!chosen.includes(entry)) chosen.push(entry);
      }
      return { ok: true, value: chosen };
    }
  }
}

function isRealDay(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** An empty multiselect counts as empty — an array with nothing in it is nothing chosen. */
function isEmpty(value: LeadFieldValue | undefined): boolean {
  if (value === undefined || value === null || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

/** `options` is a JSON column, so its type is only known to be JSON until it is read. */
function optionsOf(stored: Prisma.JsonValue): string[] {
  return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
}

function describe(row: {
  id: string;
  key: string;
  label: string;
  type: string;
  options: Prisma.JsonValue;
  required: boolean;
  order: number;
  archivedAt: Date | null;
}): LeadFieldSummary {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    // Text rather than a Postgres enum, matching every other vocabulary column in this module,
    // so the wire type is asserted here at the one boundary where the two representations meet.
    type: row.type as LeadFieldType,
    options: optionsOf(row.options),
    required: row.required,
    order: row.order,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}
