import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  DmAutomationFlowListResponse,
  DmAutomationFlowResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { Valid, validated } from '../../platform/validation';
import { DmFlowsService } from './dm-flows.service';
import { CreateDmAutomationFlowBody, UpdateDmAutomationFlowBody } from './schemas';

@Controller('api/marketing/dm-flows')
export class DmFlowsController {
  constructor(private readonly dmFlowsService: DmFlowsService) {}

  @Get()
  @RequirePermission('marketing:dm-flows:read')
  async listFlows(@Query() query: Record<string, unknown>): Promise<DmAutomationFlowListResponse> {
    return this.dmFlowsService.listFlows(query);
  }

  @Post()
  @RequirePermission('marketing:dm-flows:write')
  async createFlow(
    @Body(validated(CreateDmAutomationFlowBody)) body: Valid<typeof CreateDmAutomationFlowBody>,
  ): Promise<DmAutomationFlowResponse> {
    return this.dmFlowsService.createFlow(body);
  }

  @Get(':id')
  @RequirePermission('marketing:dm-flows:read')
  async getFlow(@Param('id') id: string): Promise<DmAutomationFlowResponse> {
    return this.dmFlowsService.getFlow(id);
  }

  @Patch(':id')
  @RequirePermission('marketing:dm-flows:write')
  async updateFlow(
    @Param('id') id: string,
    @Body(validated(UpdateDmAutomationFlowBody)) body: Valid<typeof UpdateDmAutomationFlowBody>,
  ): Promise<DmAutomationFlowResponse> {
    return this.dmFlowsService.updateFlow(id, body);
  }

  @Delete(':id')
  @RequirePermission('marketing:dm-flows:write')
  async deleteFlow(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.dmFlowsService.deleteFlow(id);
  }
}
