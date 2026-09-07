import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  BuildUtmRequest,
  BuildUtmResponse,
  UtmParameters,
} from '@erp/shared';
import { MARKETING_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';

@Injectable()
export class UtmService {
  /**
   * Builds a normalized, trackable URL with standard Google Analytics UTM parameters.
   */
  build(params: BuildUtmRequest): BuildUtmResponse {
    const rawUrl = params.url?.trim();
    if (!rawUrl) {
      throw new ApiException(
        MARKETING_ERROR_CODES.invalidUtmUrl,
        'Destination URL is required.',
        HttpStatus.BAD_REQUEST,
      );
    }

    let urlObj: URL;
    try {
      urlObj = new URL(rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`);
    } catch {
      throw new ApiException(
        MARKETING_ERROR_CODES.invalidUtmUrl,
        'Invalid destination URL format.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const source = this.sanitizeParam(params.source) || 'direct';
    const medium = this.sanitizeParam(params.medium) || 'custom';
    const campaign = this.sanitizeParam(params.campaign) || 'general';

    urlObj.searchParams.set('utm_source', source);
    urlObj.searchParams.set('utm_medium', medium);
    urlObj.searchParams.set('utm_campaign', campaign);

    if (params.term?.trim()) {
      urlObj.searchParams.set('utm_term', this.sanitizeParam(params.term));
    }
    if (params.content?.trim()) {
      urlObj.searchParams.set('utm_content', this.sanitizeParam(params.content));
    }

    const utmUrl = urlObj.toString();

    // Standard preset channels for multi-channel growth campaigns
    const channels = [
      { channel: 'Instagram Bio', source: 'instagram', medium: 'bio' },
      { channel: 'Instagram Post / Story', source: 'instagram', medium: 'social' },
      { channel: 'TikTok Bio', source: 'tiktok', medium: 'bio' },
      { channel: 'TikTok Ads', source: 'tiktok', medium: 'cpc' },
      { channel: 'Meta / Facebook Ads', source: 'facebook', medium: 'cpc' },
      { channel: 'Google Search Ads', source: 'google', medium: 'cpc' },
      { channel: 'LinkedIn Post', source: 'linkedin', medium: 'social' },
      { channel: 'Email Newsletter', source: 'newsletter', medium: 'email' },
      { channel: 'X / Twitter Post', source: 'x', medium: 'social' },
    ];

    const channelPresets = channels.map((c) => {
      const clone = new URL(utmUrl);
      clone.searchParams.set('utm_source', c.source);
      clone.searchParams.set('utm_medium', c.medium);
      return {
        channel: c.channel,
        url: clone.toString(),
      };
    });

    return {
      utmUrl,
      parameters: {
        url: rawUrl,
        source,
        medium,
        campaign,
        term: params.term?.trim(),
        content: params.content?.trim(),
      },
      channelPresets,
    };
  }

  /**
   * Extracts UTM tags from an incoming trackable link.
   */
  parse(rawUrl: string): UtmParameters | null {
    try {
      const urlObj = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
      const source = urlObj.searchParams.get('utm_source');
      const medium = urlObj.searchParams.get('utm_medium');
      const campaign = urlObj.searchParams.get('utm_campaign');

      if (!source && !medium && !campaign) {
        return null;
      }

      return {
        url: `${urlObj.origin}${urlObj.pathname}`,
        source: source || 'unknown',
        medium: medium || 'unknown',
        campaign: campaign || 'unknown',
        term: urlObj.searchParams.get('utm_term') ?? undefined,
        content: urlObj.searchParams.get('utm_content') ?? undefined,
      };
    } catch {
      return null;
    }
  }

  private sanitizeParam(val: string): string {
    return val
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_-]/g, '');
  }
}
