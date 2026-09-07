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
  type ExpiringAccountsResponse,
  type OAuthAuthorizeResponse,
  type RefreshTokenResponse,
  type SocialAccountListResponse,
  type SocialAccountResponse,
  type SocialRateLimitStatusResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import {
  ConnectSocialAccountBody,
  OAuthAuthorizeBody,
  OAuthCallbackBody,
} from './schemas';
import { SocialAccountsService } from './social-accounts.service';

@Controller(MARKETING_ROUTE)
export class SocialAccountsController {
  constructor(private readonly socialAccounts: SocialAccountsService) {}

  @Get('brands/:brandId/accounts')
  @RequirePermission('marketing:social-accounts:read')
  async listForBrand(
    @Param('brandId') brandId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<SocialAccountListResponse> {
    return this.socialAccounts.listAccounts(brandId, query);
  }

  @Post('brands/:brandId/accounts/connect')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:social-accounts:write')
  async connect(
    @Param('brandId') brandId: string,
    @Body(validated(ConnectSocialAccountBody)) body: Valid<typeof ConnectSocialAccountBody>,
  ): Promise<SocialAccountResponse> {
    return this.socialAccounts.connectAccount(brandId, body);
  }

  @Post('brands/:brandId/accounts/oauth/authorize')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('marketing:social-accounts:write')
  async authorize(
    @Param('brandId') brandId: string,
    @Body(validated(OAuthAuthorizeBody)) body: Valid<typeof OAuthAuthorizeBody>,
  ): Promise<OAuthAuthorizeResponse> {
    return this.socialAccounts.initiateOAuthFlow(brandId, body);
  }

  @Post('social-accounts/oauth/callback')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('marketing:social-accounts:write')
  async callback(
    @Body(validated(OAuthCallbackBody)) body: Valid<typeof OAuthCallbackBody>,
  ): Promise<SocialAccountResponse> {
    return this.socialAccounts.handleOAuthCallback(body);
  }

  @Get('social-accounts/:id')
  @RequirePermission('marketing:social-accounts:read')
  async one(@Param('id') id: string): Promise<SocialAccountResponse> {
    return this.socialAccounts.getAccount(id);
  }

  @Get('social-accounts/:id/rate-limits')
  @RequirePermission('marketing:social-accounts:read')
  async rateLimits(@Param('id') id: string): Promise<SocialRateLimitStatusResponse> {
    return this.socialAccounts.getRateLimitStatus(id);
  }

  @Post('social-accounts/:id/refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('marketing:social-accounts:write')
  async refresh(@Param('id') id: string): Promise<RefreshTokenResponse> {
    return this.socialAccounts.refreshToken(id);
  }

  @Delete('social-accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('marketing:social-accounts:write')
  async disconnect(@Param('id') id: string): Promise<void> {
    return this.socialAccounts.disconnectAccount(id);
  }

  @Get('brands/:brandId/expiring-tokens')
  @RequirePermission('marketing:social-accounts:read')
  async expiringTokens(
    @Param('brandId') brandId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<ExpiringAccountsResponse> {
    const days = typeof query?.days === 'string' ? parseInt(query.days, 10) : 7;
    const thresholdDays = Number.isFinite(days) ? days : 7;
    return this.socialAccounts.checkExpiringAccounts(brandId, thresholdDays);
  }
}
