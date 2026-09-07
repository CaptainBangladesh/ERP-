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
  type SnippetListResponse,
  type SnippetSummary,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { CreateSnippetBody, UpdateSnippetBody } from './schemas';
import { SnippetsService } from './snippets.service';

/** The per-brand library of first comments and calls to action. Text in, text out. */
@Controller(MARKETING_ROUTE)
export class SnippetsController {
  constructor(private readonly snippets: SnippetsService) {}

  @Get('snippets')
  @RequirePermission('marketing:snippets:read')
  async list(@Query() query: Record<string, unknown>): Promise<SnippetListResponse> {
    return this.snippets.listSnippets(query);
  }

  @Post('snippets')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:snippets:write')
  async create(
    @Body(validated(CreateSnippetBody)) body: Valid<typeof CreateSnippetBody>,
  ): Promise<SnippetSummary> {
    return this.snippets.createSnippet(body);
  }

  @Patch('snippets/:id')
  @RequirePermission('marketing:snippets:write')
  async update(
    @Param('id') id: string,
    @Body(validated(UpdateSnippetBody)) body: Valid<typeof UpdateSnippetBody>,
  ): Promise<SnippetSummary> {
    return this.snippets.updateSnippet(id, body);
  }

  @Delete('snippets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('marketing:snippets:write')
  async remove(@Param('id') id: string): Promise<void> {
    await this.snippets.deleteSnippet(id);
  }
}
