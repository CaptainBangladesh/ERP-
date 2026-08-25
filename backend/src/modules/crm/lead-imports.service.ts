import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import {
  type LeadImportCommitResponse,
  type LeadImportDryRunResponse,
  type LeadImportListResponse,
  type LeadImportRejectedRow,
  type LeadImportSummary,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { UploadedFile, validateUploadedFile } from '../../platform/upload';
import { leadImportNotFound } from './refusals';
import { LEAD_IMPORT_LIST } from './schemas';

export interface ParsedLeadRow {
  name: string;
  organisationName?: string | null;
  email?: string | null;
  phone?: string | null;
  sourceId?: string | null;
  groupName?: string | null;
  groupId?: string | null;
  assignedToUserId?: string | null;
  customValues: Record<string, any>;
}

export interface ParseAndValidateResult {
  rowCount: number;
  acceptedCount: number;
  acceptedRows: ParsedLeadRow[];
  rejected: LeadImportRejectedRow[];
  newGroupsToCreate: string[];
}

@Injectable()
export class LeadImportsService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async dryRun(
    file: UploadedFile | undefined,
    mappingRaw: string | Record<string, string>,
    defaultGroupId?: string,
    defaultSourceId?: string,
  ): Promise<LeadImportDryRunResponse> {
    const validatedFile = validateUploadedFile(file);
    const mapping = parseMapping(mappingRaw);

    const parsed = await this.parseAndValidate(validatedFile, mapping, defaultGroupId, defaultSourceId);

    return {
      accepted: parsed.acceptedCount,
      rejected: parsed.rejected,
    };
  }

  async commit(
    actor: { userId: string; name: string },
    file: UploadedFile | undefined,
    mappingRaw: string | Record<string, string>,
    defaultGroupId?: string,
    defaultSourceId?: string,
  ): Promise<LeadImportCommitResponse> {
    const validatedFile = validateUploadedFile(file);
    const mapping = parseMapping(mappingRaw);

    const parsed = await this.parseAndValidate(validatedFile, mapping, defaultGroupId, defaultSourceId);

    // 1. Resolve and create missing LeadGroups on the fly
    const existingGroups = await this.prisma.leadGroup.findMany({
      orderBy: { order: 'desc' },
    });

    const groupMap = new Map<string, string>();
    for (const g of existingGroups) {
      groupMap.set(g.name.toLowerCase().trim(), g.id);
    }

    let maxOrder = existingGroups.length > 0 ? Math.max(...existingGroups.map((g) => g.order)) : 0;

    for (const newGroupName of parsed.newGroupsToCreate) {
      const lower = newGroupName.toLowerCase().trim();
      if (!groupMap.has(lower)) {
        maxOrder++;
        const createdGroup = await this.prisma.leadGroup.create({
          data: companyApplied<Prisma.LeadGroupUncheckedCreateInput>({
            name: newGroupName,
            color: '#579bfc',
            order: maxOrder,
          }),
        });
        groupMap.set(lower, createdGroup.id);
      }
    }

    // Determine fallback default group ID if none assigned
    let fallbackGroupId = defaultGroupId;
    if (!fallbackGroupId && existingGroups.length > 0) {
      fallbackGroupId = existingGroups[0]!.id;
    } else if (!fallbackGroupId && groupMap.size > 0) {
      fallbackGroupId = Array.from(groupMap.values())[0];
    } else if (!fallbackGroupId) {
      maxOrder++;
      const createdDefault = await this.prisma.leadGroup.create({
        data: companyApplied<Prisma.LeadGroupUncheckedCreateInput>({
          name: 'Default Group',
          color: '#579bfc',
          order: maxOrder,
        }),
      });
      fallbackGroupId = createdDefault.id;
    }

    // 2. Create accepted Lead records
    for (const row of parsed.acceptedRows) {
      let resolvedGroupId = row.groupId;
      if (!resolvedGroupId && row.groupName) {
        resolvedGroupId = groupMap.get(row.groupName.toLowerCase().trim()) || fallbackGroupId;
      }
      if (!resolvedGroupId) {
        resolvedGroupId = fallbackGroupId;
      }

      await this.prisma.lead.create({
        data: companyApplied<Prisma.LeadUncheckedCreateInput>({
          name: row.name,
          organisationName: row.organisationName || null,
          email: row.email || null,
          phone: row.phone || null,
          sourceId: row.sourceId || null,
          groupId: resolvedGroupId || null,
          assignedToUserId: row.assignedToUserId || null,
          customValues: row.customValues as Prisma.InputJsonValue,
        }),
      });
    }

    // 3. Write LeadImport batch audit row
    const importRecord = await this.prisma.leadImport.create({
      data: companyApplied<Prisma.LeadImportUncheckedCreateInput>({
        filename: validatedFile.originalname || 'import.xlsx',
        rowCount: parsed.rowCount,
        acceptedCount: parsed.acceptedCount,
        importedByUserId: actor.userId,
        importedByName: actor.name,
      }),
    });

    return {
      accepted: parsed.acceptedCount,
      rejected: parsed.rejected,
      importId: importRecord.id,
    };
  }

  async listLeadImports(query: Record<string, unknown>): Promise<LeadImportListResponse> {
    const slice = listQuery(query, LEAD_IMPORT_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.leadImport.findMany(slice.findMany<Prisma.LeadImportFindManyArgs>()),
      this.prisma.leadImport.count(slice.count<Prisma.LeadImportCountArgs>()),
    ]);

    return slice.respond(rows.map(describeImport), total);
  }

  async getLeadImport(id: string): Promise<LeadImportSummary> {
    const record = await this.prisma.leadImport.findFirst({ where: { id } });
    if (!record) throw leadImportNotFound();
    return describeImport(record);
  }

  private async parseAndValidate(
    file: UploadedFile,
    mapping: Record<string, string>,
    defaultGroupId?: string,
    defaultSourceId?: string,
  ): Promise<ParseAndValidateResult> {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(file.buffer, { type: 'buffer' });
    } catch {
      throw new ApiException('invalid_file_type', 'Could not parse spreadsheet file.', HttpStatus.BAD_REQUEST);
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new ApiException('invalid_file_type', 'Spreadsheet contains no sheets.', HttpStatus.BAD_REQUEST);
    }

    // Fetch custom definitions, sources, existing groups, and existing leads
    const [definitions, sources, groups, existingLeads] = await Promise.all([
      this.prisma.leadFieldDefinition.findMany({ orderBy: { order: 'asc' } }),
      this.prisma.leadSource.findMany({ select: { id: true } }),
      this.prisma.leadGroup.findMany({ select: { id: true, name: true } }),
      this.prisma.lead.findMany({ select: { name: true, email: true, phone: true } }),
    ]);

    const liveDefinitions = definitions.filter((def) => def.archivedAt === null);
    const defByKey = new Map(liveDefinitions.map((def) => [def.key, def]));
    const defByLabel = new Map(liveDefinitions.map((def) => [def.label.toLowerCase(), def]));
    const validSourceIds = new Set(sources.map((s) => s.id));
    const validGroupIds = new Set(groups.map((g) => g.id));
    const existingGroupNames = new Set(groups.map((g) => g.name.toLowerCase().trim()));

    const existingEmails = new Set(existingLeads.map((l) => l.email?.trim().toLowerCase()).filter(Boolean));
    const existingPhones = new Set(existingLeads.map((l) => l.phone?.trim()).filter(Boolean));
    const existingNames = new Set(existingLeads.map((l) => l.name.trim().toLowerCase()).filter(Boolean));

    const acceptedRows: ParsedLeadRow[] = [];
    const rejected: LeadImportRejectedRow[] = [];
    const newGroupsSet = new Set<string>();
    let totalValidDataRowCount = 0;

    // Scan across ALL sheets in the workbook
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
      if (!rows || rows.length === 0) continue;

      // Detect header row (first 10 rows)
      let headerIdx = -1;
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const r = rows[i] || [];
        const text = r.map((c) => String(c).toLowerCase().trim()).join(' ');
        if (
          text.includes('category') ||
          text.includes('group') ||
          text.includes('shop') ||
          text.includes('name') ||
          text.includes('phone') ||
          text.includes('email') ||
          text.includes('lead')
        ) {
          headerIdx = i;
          break;
        }
      }

      let headerRow: string[] = [];
      let dataRows: any[][] = [];

      if (headerIdx !== -1) {
        headerRow = (rows[headerIdx] || []).map((c) => String(c).trim());
        dataRows = rows.slice(headerIdx + 1);
      } else {
        headerRow = ['Category', 'Shop Name', 'Phone No', 'FB link', 'Email'];
        dataRows = rows;
      }

      // Build column index mapping for this sheet (disallow duplicate mapping of built-in fields)
      const colIndexToField = new Map<number, string>();
      const mappedBuiltIns = new Set<string>();

      for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
        const rawHeader = headerRow[colIdx] || '';
        const cleanHeader = rawHeader.toLowerCase().trim();

        // 1. Check user explicit mapping
        let targetField: string | undefined;
        for (const [keyOrHeader, target] of Object.entries(mapping)) {
          if (!target) continue;
          if (
            keyOrHeader.toLowerCase() === cleanHeader ||
            ( /^\d+$/.test(keyOrHeader) && parseInt(keyOrHeader, 10) === colIdx )
          ) {
            targetField = target;
            break;
          }
        }

        // 2. Auto-detect if not explicitly mapped
        if (!targetField) {
          targetField = autoMatchField(cleanHeader, colIdx, liveDefinitions);
        }

        if (targetField) {
          if (isBuiltInField(targetField)) {
            // Only assign built-in field to the FIRST matching column
            if (!mappedBuiltIns.has(targetField)) {
              mappedBuiltIns.add(targetField);
              colIndexToField.set(colIdx, targetField);
            }
          } else {
            colIndexToField.set(colIdx, targetField);
          }
        }
      }

      for (let i = 0; i < dataRows.length; i++) {
        const rowCells = dataRows[i] || [];
        const isRowEmpty = rowCells.every(
          (cell) => cell === null || cell === undefined || String(cell).trim() === '',
        );
        if (isRowEmpty) continue;

        totalValidDataRowCount++;
        const fileRowNumber = i + (headerIdx !== -1 ? headerIdx + 2 : 1);

        const builtIn: Record<string, string> = {};
        const customSubmitted: Record<string, any> = {};

        for (let colIdx = 0; colIdx < Math.max(rowCells.length, headerRow.length); colIdx++) {
          const rawValue = rowCells[colIdx];
          if (rawValue === undefined || rawValue === null) continue;
          const strVal = String(rawValue).trim();
          if (strVal === '') continue;

          // Strict type protection: Email, Phone, URL are never assigned to name
          if (isEmail(strVal)) {
            if (!builtIn['email']) builtIn['email'] = strVal;
            continue;
          }

          if (isUrl(strVal)) {
            if (!customSubmitted['fb_link']) customSubmitted['fb_link'] = strVal;
            continue;
          }

          if (isPhone(strVal)) {
            if (!builtIn['phone']) builtIn['phone'] = strVal;
            continue;
          }

          const targetField = colIndexToField.get(colIdx);
          if (targetField) {
            if (isBuiltInField(targetField)) {
              if (!builtIn[targetField]) {
                builtIn[targetField] = strVal;
              }
            } else {
              let def = defByKey.get(targetField);
              if (!def) {
                def = defByLabel.get(targetField.toLowerCase());
              }
              const fieldKey = def ? def.key : targetField;
              if (!customSubmitted[fieldKey]) {
                customSubmitted[fieldKey] = rawValue;
              }
            }
          } else {
            // Unmapped non-type cell fallback
            if (colIdx === 0 && !builtIn['groupId']) {
              builtIn['groupId'] = strVal;
            } else if (!builtIn['name']) {
              builtIn['name'] = strVal;
            }
          }
        }

        // Final Name Fallback
        if (!builtIn['name']) {
          if (builtIn['organisationName']) {
            builtIn['name'] = builtIn['organisationName'];
          } else {
            for (let c = 0; c < rowCells.length; c++) {
              const v = String(rowCells[c] || '').trim();
              if (v && !isEmail(v) && !isUrl(v) && !isPhone(v) && v !== builtIn['groupId']) {
                builtIn['name'] = v;
                break;
              }
            }
          }
        }

        const rowRejections: LeadImportRejectedRow[] = [];

        // Validate name requirement
        const name = builtIn['name'] || builtIn['organisationName'];
        if (!name) {
          rowRejections.push({
            row: fileRowNumber,
            field: 'name',
            message: 'Name is required.',
          });
        }

        const email = builtIn['email'];
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          rowRejections.push({
            row: fileRowNumber,
            field: 'email',
            message: 'Invalid email address format.',
          });
        }

        const phone = builtIn['phone'];

        // Check for duplicate lead info
        const normName = name?.trim().toLowerCase();
        const normEmail = email?.trim().toLowerCase();
        const normPhone = phone?.trim();

        if (
          (normEmail && existingEmails.has(normEmail)) ||
          (normPhone && existingPhones.has(normPhone)) ||
          (normName && existingNames.has(normName))
        ) {
          rowRejections.push({
            row: fileRowNumber,
            field: 'name',
            message: 'Duplicate lead: A lead with this information already exists.',
          });
        }

        const sourceId = builtIn['sourceId'] || defaultSourceId;
        if (sourceId && !validSourceIds.has(sourceId)) {
          rowRejections.push({
            row: fileRowNumber,
            field: 'sourceId',
            message: 'That lead source does not exist.',
          });
        }

        // Handle Group / Category resolution
        let resolvedGroupId: string | null = null;
        let groupName: string | null = null;

        const rawGroupVal = builtIn['groupId'];
        if (rawGroupVal) {
          if (validGroupIds.has(rawGroupVal)) {
            resolvedGroupId = rawGroupVal;
          } else {
            // It's a group name string (e.g. "Automotive", "Baby & Kids")
            groupName = rawGroupVal.trim();
            if (!existingGroupNames.has(groupName.toLowerCase())) {
              newGroupsSet.add(groupName);
            }
          }
        } else if (defaultGroupId && validGroupIds.has(defaultGroupId)) {
          resolvedGroupId = defaultGroupId;
        }

        // Validate custom fields
        const validatedCustomValues: Record<string, any> = {};
        for (const [key, rawVal] of Object.entries(customSubmitted)) {
          const def = defByKey.get(key);
          if (def) {
            const read = readCustomValue(def.type, optionsOf(def.options), rawVal);
            if (!read.ok) {
              rowRejections.push({
                row: fileRowNumber,
                field: key,
                message: `${def.label}: ${read.message}`,
              });
            } else if (read.value !== null) {
              validatedCustomValues[key] = read.value;
            }
          } else {
            // Store unrecognized extra fields (e.g. fb_link) directly into customValues
            validatedCustomValues[key] = rawVal;
          }
        }

        if (rowRejections.length > 0) {
          rejected.push(...rowRejections);
        } else {
          acceptedRows.push({
            name: name!,
            organisationName: builtIn['organisationName'] || null,
            email: email || null,
            phone: builtIn['phone'] || null,
            sourceId: sourceId || null,
            groupName: groupName || null,
            groupId: resolvedGroupId || null,
            assignedToUserId: builtIn['assignedToUserId'] || null,
            customValues: validatedCustomValues,
          });
        }
      }
    }

    return {
      rowCount: totalValidDataRowCount,
      acceptedCount: acceptedRows.length,
      acceptedRows,
      rejected,
      newGroupsToCreate: Array.from(newGroupsSet),
    };
  }
}

function autoMatchField(
  header: string,
  colIdx: number,
  customFields: Array<{ key: string; label: string }>,
): string | undefined {
  const clean = header.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (['group', 'category', 'leadgroup', 'segment'].includes(clean)) return 'groupId';
  if (['name', 'leadname', 'fullname', 'contactname', 'shopname', 'businessname', 'title'].includes(clean)) return 'name';
  if (['phone', 'phoneno', 'phonenumber', 'contact', 'mobile', 'cell'].includes(clean)) return 'phone';
  if (['email', 'emailaddress', 'mail'].includes(clean)) return 'email';
  if (['organisation', 'organisationname', 'organization', 'organizationname', 'company', 'companyname'].includes(clean)) return 'organisationName';
  if (['source', 'leadsource', 'channel'].includes(clean)) return 'sourceId';

  for (const cf of customFields) {
    const cfLabelClean = cf.label.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cfKeyClean = cf.key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean === cfLabelClean || clean === cfKeyClean) return cf.key;
  }

  // Fallback by standard column index
  if (colIdx === 0 && clean.length === 0) return 'groupId';
  if (colIdx === 1 && clean.length === 0) return 'name';
  if (colIdx === 2 && clean.length === 0) return 'phone';
  if (colIdx === 3 && clean.length === 0) return 'fb_link';
  if (colIdx === 4 && clean.length === 0) return 'email';

  return undefined;
}

function isBuiltInField(field: string): boolean {
  return [
    'name',
    'organisationName',
    'email',
    'phone',
    'sourceId',
    'groupId',
    'assignedToUserId',
  ].includes(field);
}

function isEmail(str: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

function isUrl(str: string): boolean {
  return /^https?:\/\//i.test(str) || str.includes('facebook.com');
}

function isPhone(str: string): boolean {
  return /^[\d\s\-\+\(\)]{7,20}$/.test(str);
}

function parseMapping(raw: string | Record<string, string>): Record<string, string> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      throw new ApiException('invalid_mapping', 'The column mapping provided is not valid JSON.', HttpStatus.BAD_REQUEST);
    }
  }
  if (typeof raw === 'object' && raw !== null) {
    return raw;
  }
  return {};
}

function readCustomValue(
  type: string,
  options: string[],
  value: unknown,
): { ok: true; value: any } | { ok: false; message: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };

  const strVal = String(value).trim();

  switch (type) {
    case 'text':
      if (strVal.length > 2000) return { ok: false, message: 'use 2000 characters or fewer.' };
      return { ok: true, value: strVal };

    case 'number': {
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) return { ok: false, message: 'enter a number.' };
        return { ok: true, value };
      }
      if (/^-?\d+(\.\d+)?$/.test(strVal)) {
        return { ok: true, value: Number(strVal) };
      }
      return { ok: false, message: 'enter a number.' };
    }

    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(strVal)) {
        return { ok: false, message: 'enter a date, as YYYY-MM-DD.' };
      }
      const parsed = new Date(`${strVal}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== strVal) {
        return { ok: false, message: 'that is not a date on the calendar.' };
      }
      return { ok: true, value: strVal };
    }

    case 'checkbox': {
      if (typeof value === 'boolean') return { ok: true, value };
      const lower = strVal.toLowerCase();
      if (['true', 'yes', '1'].includes(lower)) return { ok: true, value: true };
      if (['false', 'no', '0'].includes(lower)) return { ok: true, value: false };
      return { ok: false, message: 'enter true or false.' };
    }

    case 'select': {
      if (!options.includes(strVal)) {
        return { ok: false, message: `'${strVal}' is not one of the options.` };
      }
      return { ok: true, value: strVal };
    }

    case 'multiselect': {
      const items = Array.isArray(value)
        ? value.map((v) => String(v).trim())
        : strVal.split(',').map((s) => s.trim()).filter(Boolean);

      const chosen: string[] = [];
      for (const item of items) {
        if (!options.includes(item)) {
          return { ok: false, message: `'${item}' is not one of the options.` };
        }
        if (!chosen.includes(item)) chosen.push(item);
      }
      return { ok: true, value: chosen };
    }

    default:
      return { ok: true, value: strVal };
  }
}

function optionsOf(stored: Prisma.JsonValue): string[] {
  return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
}

function describeImport(row: {
  id: string;
  filename: string;
  rowCount: number;
  acceptedCount: number;
  importedByUserId: string;
  importedByName: string;
  createdAt: Date;
}): LeadImportSummary {
  return {
    id: row.id,
    filename: row.filename,
    rowCount: row.rowCount,
    acceptedCount: row.acceptedCount,
    importedByUserId: row.importedByUserId,
    importedByName: row.importedByName,
    createdAt: row.createdAt.toISOString(),
  };
}
