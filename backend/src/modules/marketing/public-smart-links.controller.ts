import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Redirect,
  Req,
} from '@nestjs/common';
import type {
  PublicSmartLinkResponse,
  ShoppableGridItem,
  SmartLinkButton,
  SmartLinkSocialItem,
} from '@erp/shared';
import { Public } from '../../platform/auth';
import { CSP_NONCE, type NonceCarrier } from './bio-page-csp.middleware';
import { Throttle } from '../../platform/throttling';
import { validated, type Valid } from '../../platform/validation';
import { RecordSmartLinkClickBody } from './schemas';
import { SmartLinksService } from './smart-links.service';

@Controller()
export class PublicSmartLinksController {
  constructor(private readonly smartLinks: SmartLinksService) {}

  @Public()
  @Get('b/:slug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=60, s-maxage=300')
  async getBioPageHtml(
    @Param('slug') slug: string,
    @Req() req: NonceCarrier,
  ): Promise<string> {
    // `BioPageCspMiddleware` has already set the policy naming this nonce.
    const link = await this.smartLinks.getPublicPage(slug);
    return this.smartLinks.renderHtml(link, req[CSP_NONCE] ?? '');
  }

  @Public()
  @Get('api/public/smart-links/:slug')
  async getBioPageJson(@Param('slug') slug: string): Promise<PublicSmartLinkResponse> {
    const link = await this.smartLinks.getPublicPage(slug);
    return {
      slug: link.slug,
      title: link.title,
      bio: link.bio,
      avatarUrl: link.avatarUrl,
      theme: link.theme,
      buttonLinks: (Array.isArray(link.buttonLinks) ? link.buttonLinks : []) as SmartLinkButton[],
      shoppableGrid: (Array.isArray(link.shoppableGrid)
        ? link.shoppableGrid
        : []) as ShoppableGridItem[],
      socialLinks: (Array.isArray(link.socialLinks)
        ? link.socialLinks
        : []) as SmartLinkSocialItem[],
    };
  }

  /**
   * The click beacon — an unauthenticated write, so it is throttled per IP and per slug.
   *
   * Keyed by slug as well as by caller so that one page being hammered cannot spend another
   * page's budget. See the module README for what the in-memory store does and does not
   * promise once this runs on more than one instance.
   */
  @Public()
  @Throttle({ max: 60, ttl: 60_000, by: 'slug' })
  @Post('b/:slug/clicks')
  @HttpCode(HttpStatus.OK)
  async recordClick(
    @Param('slug') slug: string,
    @Body(validated(RecordSmartLinkClickBody)) body: Valid<typeof RecordSmartLinkClickBody>,
    @Req() req: { headers?: Record<string, string | string[] | undefined> },
  ): Promise<{ recorded: boolean; targetUrl?: string }> {
    const userAgent = Array.isArray(req.headers?.['user-agent'])
      ? req.headers['user-agent'][0]
      : req.headers?.['user-agent'];
    const referer = Array.isArray(req.headers?.referer)
      ? req.headers.referer[0]
      : req.headers?.referer;

    return this.smartLinks.recordPublicClick(slug, body, {
      userAgent,
      referer,
    });
  }

  @Public()
  @Throttle({ max: 60, ttl: 60_000, by: 'slug' })
  @Get('b/:slug/c/:buttonId')
  @Redirect()
  async redirectClick(
    @Param('slug') slug: string,
    @Param('buttonId') buttonId: string,
    @Req() req: { headers?: Record<string, string | string[] | undefined> },
  ): Promise<{ url: string; statusCode: number }> {
    const userAgent = Array.isArray(req.headers?.['user-agent'])
      ? req.headers['user-agent'][0]
      : req.headers?.['user-agent'];
    const referer = Array.isArray(req.headers?.referer)
      ? req.headers.referer[0]
      : req.headers?.referer;

    const result = await this.smartLinks.recordPublicClick(slug, { buttonId }, {
      userAgent,
      referer,
    });

    return {
      url: result.targetUrl || `/b/${slug}`,
      statusCode: HttpStatus.FOUND,
    };
  }
}
