import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CRM_ROUTE,
  type LeadImportCommitResponse,
  type LeadImportDryRunResponse,
  type LeadImportListResponse,
  type LeadImportSummary,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import type { UploadedFile as PlatformUploadedFile } from '../../platform/upload';
import { validated, type Valid } from '../../platform/validation';
import { LeadImportsService } from './lead-imports.service';
import { ImportLeadsBody } from './schemas';

@Controller(CRM_ROUTE)
export class LeadImportsController {
  constructor(private readonly leadImportsService: LeadImportsService) {}

  @Post(['leads/import/dry-run', 'lead-imports/dry-run'])
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  @UseInterceptors(FileInterceptor('file'))
  async dryRun(
    @UploadedFile() file: PlatformUploadedFile | undefined,
    @Body(validated(ImportLeadsBody)) body: Valid<typeof ImportLeadsBody>,
  ): Promise<LeadImportDryRunResponse> {
    return this.leadImportsService.dryRun(
      file,
      body.mapping || '{}',
      body.groupId,
      body.sourceId,
    );
  }

  @Post(['leads/import/commit', 'lead-imports/commit'])
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  @UseInterceptors(FileInterceptor('file'))
  async commit(
    @CurrentSession() session: RequestSession,
    @UploadedFile() file: PlatformUploadedFile | undefined,
    @Body(validated(ImportLeadsBody)) body: Valid<typeof ImportLeadsBody>,
  ): Promise<LeadImportCommitResponse> {
    return this.leadImportsService.commit(
      { userId: session.user.id, name: session.user.name },
      file,
      body.mapping || '{}',
      body.groupId,
      body.sourceId,
    );
  }

  @Get('lead-imports')
  @RequirePermission('crm:leads:read')
  async listLeadImports(
    @Query() query: Record<string, unknown>,
  ): Promise<LeadImportListResponse> {
    return this.leadImportsService.listLeadImports(query);
  }

  @Get('lead-imports/:id')
  @RequirePermission('crm:leads:read')
  async getLeadImport(@Param('id') id: string): Promise<LeadImportSummary> {
    return this.leadImportsService.getLeadImport(id);
  }
}
