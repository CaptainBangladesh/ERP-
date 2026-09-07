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
} from '@erp/shared';
import { Public } from '../../platform/auth';
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
  async getBioPageHtml(@Param('slug') slug: string): Promise<string> {
    const link = await this.smartLinks.getPublicPage(slug);
    return this.smartLinks.renderHtml(link);
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
      buttonLinks: (Array.isArray(link.buttonLinks) ? link.buttonLinks : []) as any,
      shoppableGrid: (Array.isArray(link.shoppableGrid) ? link.shoppableGrid : []) as any,
      socialLinks: (Array.isArray(link.socialLinks) ? link.socialLinks : []) as any,
    };
  }

  @Public()
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
