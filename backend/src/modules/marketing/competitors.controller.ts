import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  MARKETING_ROUTE,
  type CompetitorListResponse,
  type CompetitorSnapshotListResponse,
  type CompetitorSummary,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { CompetitorsService } from './competitors.service';
import { CreateCompetitorBody } from './schemas';

/** Competitor handles and their daily aggregates. Read through the networks' own APIs (15a). */
@Controller(MARKETING_ROUTE)
export class CompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

  @Get('competitors')
  @RequirePermission('marketing:competitors:read')
  async list(@Query() query: Record<string, unknown>): Promise<CompetitorListResponse> {
    return this.competitors.listCompetitors(query);
  }

  @Post('competitors')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:competitors:write')
  async create(
    @Body(validated(CreateCompetitorBody)) body: Valid<typeof CreateCompetitorBody>,
  ): Promise<CompetitorSummary> {
    return this.competitors.createCompetitor(body);
  }

  /** Enqueues; the network read happens on the queue, metered against publishing (15b, 15e). */
  @Post('competitors/:id/snapshot')
  @RequirePermission('marketing:competitors:write')
  async snapshot(@Param('id') id: string): Promise<CompetitorSummary> {
    return this.competitors.requestSnapshot(id);
  }

  @Delete('competitors/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('marketing:competitors:write')
  async remove(@Param('id') id: string): Promise<void> {
    await this.competitors.deleteCompetitor(id);
  }

  @Get('competitor-snapshots')
  @RequirePermission('marketing:competitors:read')
  async snapshots(
    @Query() query: Record<string, unknown>,
  ): Promise<CompetitorSnapshotListResponse> {
    return this.competitors.listSnapshots(query);
  }
}
