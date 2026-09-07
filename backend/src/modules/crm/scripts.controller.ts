import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CRM_ROUTE,
  type ScriptListResponse,
  type ScriptResponse,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { ScriptsService } from './scripts.service';
import { CreateScriptBody, UpdateScriptBody } from './schemas';

/**
 * Reading scripts is gated by `crm:leads:read` — a rep working a lead sees them — while
 * authoring is gated by `crm:playbooks:write`, the manager gate for the whole content track.
 */
@Controller(CRM_ROUTE)
export class ScriptsController {
  constructor(private readonly scriptsService: ScriptsService) {}

  @Get('scripts')
  @RequirePermission('crm:leads:read')
  async listScripts(): Promise<ScriptListResponse> {
    const items = await this.scriptsService.list();
    return { items };
  }

  @Get('scripts/:id')
  @RequirePermission('crm:leads:read')
  async getScript(@Param('id') id: string): Promise<ScriptResponse> {
    return this.scriptsService.get(id);
  }

  @Post('scripts')
  @RequirePermission('crm:playbooks:write')
  async createScript(
    @CurrentSession() session: RequestSession,
    @Body(validated(CreateScriptBody)) body: Valid<typeof CreateScriptBody>,
  ): Promise<ScriptResponse> {
    return this.scriptsService.create(body, { userId: session.user.id });
  }

  @Patch('scripts/:id')
  @RequirePermission('crm:playbooks:write')
  async updateScript(
    @Param('id') id: string,
    @Body(validated(UpdateScriptBody)) body: Valid<typeof UpdateScriptBody>,
  ): Promise<ScriptResponse> {
    return this.scriptsService.update(id, body);
  }

  @Delete('scripts/:id')
  @RequirePermission('crm:playbooks:write')
  @HttpCode(HttpStatus.OK)
  async deleteScript(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.scriptsService.delete(id);
  }
}
