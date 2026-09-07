import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Options,
  Post,
  Req,
} from '@nestjs/common';
import { Public } from '../../platform/auth';
import { Throttle } from '../../platform/throttling';
import { validated, type Valid } from '../../platform/validation';
import { CollectEventBody } from './schemas';
import { TrackingService } from './tracking.service';

@Controller('api/marketing')
export class PublicTrackingController {
  constructor(private readonly tracking: TrackingService) {}

  /**
   * Serve the lightweight client-side JavaScript tracking snippet.
   */
  @Public()
  @Get('pixel.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  getPixelJs(): string {
    return this.tracking.getPixelScript();
  }

  /**
   * High-throughput CORS-enabled beacon collector endpoint.
   * Returns HTTP 204 No Content.
   */
  @Public()
  @Throttle({ max: 120, ttl: 60_000, by: 'pixelKey' })
  @Post('collect')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Access-Control-Allow-Methods', 'POST, OPTIONS')
  @Header('Access-Control-Allow-Headers', 'Content-Type')
  async collect(
    @Body(validated(CollectEventBody)) body: Valid<typeof CollectEventBody>,
    @Req() req: {
      headers?: Record<string, string | string[] | undefined>;
      ip?: string;
      socket?: { remoteAddress?: string };
    },
  ): Promise<void> {
    const userAgent = Array.isArray(req.headers?.['user-agent'])
      ? req.headers['user-agent'][0]
      : req.headers?.['user-agent'];
    const referer = Array.isArray(req.headers?.referer)
      ? req.headers.referer[0]
      : req.headers?.referer;
    const ip = req.ip || req.socket?.remoteAddress;

    await this.tracking.recordBeacon(body, {
      userAgent,
      referer,
      ip,
    });
  }

  /**
   * Handle CORS preflight for cross-origin tracking beacons.
   */
  @Public()
  @Options('collect')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Access-Control-Allow-Methods', 'POST, OPTIONS')
  @Header('Access-Control-Allow-Headers', 'Content-Type')
  collectOptions(): void {
    // 204 No Content for preflight OPTIONS
  }
}
