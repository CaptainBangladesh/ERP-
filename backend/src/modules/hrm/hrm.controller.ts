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
  Query,
} from '@nestjs/common';
import {
  HRM_ROUTE,
  type EmployeeListResponse,
  type EmployeeResponse,
  type PayRunListResponse,
  type PayRunResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { HrmService } from './hrm.service';
import { CalculatePayRunBody, CreateEmployeeBody, UpdateEmployeeBody } from './schemas';

/**
 * The stub's surface.
 *
 * Nothing is `@Public()`, nothing takes a company, and there is no endpoint that edits or
 * deletes anything — a pay run is calculated once and then only read. The absence is the
 * design: immutability that depends on nobody adding a `PATCH` later is not immutability,
 * which is why the platform refuses the write as well.
 *
 * The two list endpoints hand their whole query object to the service, which reads it against
 * the declaration in `schemas.ts`. Nothing here names a parameter: `page`, `sort`, `search`
 * and the filters are the platform's convention, identical in every module, and a controller
 * with an opinion about them would be a module inventing its own.
 */
@Controller(HRM_ROUTE)
export class HrmController {
  constructor(private readonly hrm: HrmService) {}

  @Post('employees')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('hrm:employees:write')
  async addEmployee(
    @Body(validated(CreateEmployeeBody)) body: Valid<typeof CreateEmployeeBody>,
  ): Promise<EmployeeResponse> {
    return this.hrm.addEmployee(body);
  }

  @Get('employees')
  @RequirePermission('hrm:employees:read')
  async listEmployees(
    @Query() query: Record<string, unknown>,
  ): Promise<EmployeeListResponse> {
    return this.hrm.listEmployees(query);
  }

  @Patch('employees/:id')
  @RequirePermission('hrm:employees:write')
  async changeEmployee(
    @Param('id') id: string,
    @Body(validated(UpdateEmployeeBody)) body: Valid<typeof UpdateEmployeeBody>,
  ): Promise<EmployeeResponse> {
    return this.hrm.changeEmployee(id, body);
  }

  @Delete('employees/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('hrm:employees:write')
  async removeEmployee(@Param('id') id: string): Promise<void> {
    await this.hrm.removeEmployee(id);
  }

  @Post('pay-runs')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('hrm:pay-runs:write')
  async calculatePayRun(
    @Body(validated(CalculatePayRunBody)) body: Valid<typeof CalculatePayRunBody>,
  ): Promise<PayRunResponse> {
    return this.hrm.calculatePayRun(body);
  }

  @Get('pay-runs')
  @RequirePermission('hrm:pay-runs:read')
  async listPayRuns(@Query() query: Record<string, unknown>): Promise<PayRunListResponse> {
    return this.hrm.listPayRuns(query);
  }

  @Get('pay-runs/:id')
  @RequirePermission('hrm:pay-runs:read')
  async payRun(@Param('id') id: string): Promise<PayRunResponse> {
    return this.hrm.payRun(id);
  }
}
