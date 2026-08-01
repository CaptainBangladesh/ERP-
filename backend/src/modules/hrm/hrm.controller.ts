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
  HRM_ROUTE,
  type CalculatePayRunRequest,
  type CreateEmployeeRequest,
  type EmployeeListResponse,
  type EmployeeResponse,
  type PayRunListResponse,
  type PayRunResponse,
  type UpdateEmployeeRequest,
} from '@erp/shared';
import { HrmService } from './hrm.service';

/**
 * The stub's surface.
 *
 * Nothing is `@Public()`, nothing takes a company, and there is no endpoint that edits or
 * deletes anything — a pay run is calculated once and then only read. The absence is the
 * design: immutability that depends on nobody adding a `PATCH` later is not immutability,
 * which is why the platform refuses the write as well.
 */
@Controller(HRM_ROUTE)
export class HrmController {
  constructor(private readonly hrm: HrmService) {}

  @Post('employees')
  @HttpCode(HttpStatus.CREATED)
  async addEmployee(
    @Body() body: Partial<CreateEmployeeRequest>,
  ): Promise<EmployeeResponse> {
    return this.hrm.addEmployee(body);
  }

  @Get('employees')
  async listEmployees(): Promise<EmployeeListResponse> {
    return this.hrm.listEmployees();
  }

  @Patch('employees/:id')
  async changeEmployee(
    @Param('id') id: string,
    @Body() body: Partial<UpdateEmployeeRequest>,
  ): Promise<EmployeeResponse> {
    return this.hrm.changeEmployee(id, body);
  }

  @Delete('employees/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeEmployee(@Param('id') id: string): Promise<void> {
    await this.hrm.removeEmployee(id);
  }

  @Post('pay-runs')
  @HttpCode(HttpStatus.CREATED)
  async calculatePayRun(
    @Body() body: Partial<CalculatePayRunRequest>,
  ): Promise<PayRunResponse> {
    return this.hrm.calculatePayRun(body);
  }

  @Get('pay-runs')
  async listPayRuns(): Promise<PayRunListResponse> {
    return this.hrm.listPayRuns();
  }

  @Get('pay-runs/:id')
  async payRun(@Param('id') id: string): Promise<PayRunResponse> {
    return this.hrm.payRun(id);
  }
}
