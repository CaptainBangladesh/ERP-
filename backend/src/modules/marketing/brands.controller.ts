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
  MARKETING_ROUTE,
  type BrandDetailResponse,
  type BrandListResponse,
  type BrandMemberSummary,
  type BrandSummary,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { BrandsService } from './brands.service';
import { AddBrandMemberBody, CreateBrandBody, UpdateBrandBody } from './schemas';

@Controller(MARKETING_ROUTE)
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Post('brands')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:brands:write')
  async create(
    @Body(validated(CreateBrandBody)) body: Valid<typeof CreateBrandBody>,
    @CurrentSession() session: RequestSession,
  ): Promise<BrandSummary> {
    return this.brands.createBrand(body, session?.user?.id);
  }

  @Get('brands')
  @RequirePermission('marketing:brands:read')
  async list(@Query() query: Record<string, unknown>): Promise<BrandListResponse> {
    return this.brands.listBrands(query);
  }

  @Get('brands/:id')
  @RequirePermission('marketing:brands:read')
  async one(@Param('id') id: string): Promise<BrandDetailResponse> {
    return this.brands.getBrandDetail(id);
  }

  @Patch('brands/:id')
  @RequirePermission('marketing:brands:write')
  async change(
    @Param('id') id: string,
    @Body(validated(UpdateBrandBody)) body: Valid<typeof UpdateBrandBody>,
  ): Promise<BrandSummary> {
    return this.brands.updateBrand(id, body);
  }

  @Delete('brands/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('marketing:brands:write')
  async remove(@Param('id') id: string): Promise<void> {
    return this.brands.deleteBrand(id);
  }

  @Post('brands/:id/members')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:brands:write')
  async addMember(
    @Param('id') id: string,
    @Body(validated(AddBrandMemberBody)) body: Valid<typeof AddBrandMemberBody>,
  ): Promise<BrandMemberSummary> {
    return this.brands.addMember(id, body);
  }

  @Delete('brands/:id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('marketing:brands:write')
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.brands.removeMember(id, userId);
  }

  @Get('brands/:id/members')
  @RequirePermission('marketing:brands:read')
  async listMembers(@Param('id') id: string): Promise<BrandMemberSummary[]> {
    return this.brands.listMembers(id);
  }
}
