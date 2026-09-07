import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  PublicSmartLinkResponse,
  RecordSmartLinkClickRequest,
  ShoppableGridItem,
  SmartLinkButton,
  SmartLinkDetailResponse,
  SmartLinkListResponse,
  SmartLinkSocialItem,
  SmartLinkSummary,
  SmartLinkTheme,
} from '@erp/shared';
import { MARKETING_ERROR_CODES, SMART_LINK_COLOR_PATTERN } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, Tenancy, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import {
  readLinkUrl,
  SMART_LINK_LIST,
  type CreateSmartLinkBody,
  type UpdateSmartLinkBody,
} from './schemas';

const DEFAULT_THEME: SmartLinkTheme = {
  primaryColor: '#6366f1',
  backgroundColor: '#0f172a',
  textColor: '#f8fafc',
  cardStyle: 'glassmorphism',
  fontFamily: 'system',
};

/**
 * What each font *identifier* means, decided here and never by the caller.
 *
 * The database stores `'system'`; the CSS lives in this file. That is the whole point of the
 * indirection — a stored value can name a stack but can never be one, so nothing a user typed
 * reaches a `<style>` block even if every other guard fails.
 */
const FONT_STACKS: Record<string, string> = {
  system: 'system-ui, -apple-system, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif',
  condensed: '"Roboto Condensed", "Arial Narrow", system-ui, sans-serif',
};

@Injectable()
export class SmartLinksService {
  private readonly logger = new Logger(SmartLinksService.name);

  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
  ) {}

  async create(input: Valid<typeof CreateSmartLinkBody>): Promise<SmartLinkSummary> {
    const brand = await this.prisma.marketingBrand.findUnique({
      where: { id: input.brandId },
    });
    if (!brand) {
      throw new ApiException(
        MARKETING_ERROR_CODES.brandNotFound,
        'Brand not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');

    // Check slug uniqueness globally or within company
    const existing = await this.tenancy.withoutCompanyScope(
      'marketing.smart_link.check_slug',
      async () => {
        return (this.prisma as any).smartLink.findUnique({
          where: { slug },
        });
      },
    );

    if (existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.smartLinkSlugTaken,
        `The slug '${slug}' is already in use. Choose another custom slug.`,
        HttpStatus.CONFLICT,
      );
    }

    const smartLink = await this.prisma.smartLink.create({
      data: companyApplied<Prisma.SmartLinkUncheckedCreateInput>({
        brandId: input.brandId,
        campaignId: input.campaignId || null,
        slug,
        title: input.title.trim(),
        bio: input.bio?.trim() || null,
        avatarUrl: input.avatarUrl?.trim() || null,
        theme: (input.theme as any) || (DEFAULT_THEME as any),
        buttonLinks: (input.buttonLinks as any) || [],
        shoppableGrid: (input.shoppableGrid as any) || [],
        socialLinks: (input.socialLinks as any) || [],
        viewCount: 0,
        clickCount: 0,
        clicks: [],
        isActive: true,
      }),
    });

    return this.toSummary(smartLink);
  }

  async list(query: Record<string, unknown> = {}): Promise<SmartLinkListResponse> {
    const slice = listQuery(query, SMART_LINK_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.smartLink.findMany(slice.findMany<Prisma.SmartLinkFindManyArgs>()),
      this.prisma.smartLink.count(slice.count<Prisma.SmartLinkCountArgs>()),
    ]);

    return slice.respond(rows.map((l) => this.toSummary(l)), total);
  }

  async get(id: string): Promise<SmartLinkDetailResponse> {
    const link = await this.prisma.smartLink.findUnique({
      where: { id },
    });
    if (!link) {
      throw new ApiException(
        MARKETING_ERROR_CODES.smartLinkNotFound,
        'SmartLink not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const summary = this.toSummary(link);
    const clicksLog = (Array.isArray(link.clicks) ? link.clicks : []) as Array<{
      timestamp: string;
      buttonId?: string;
      targetUrl?: string;
      referer?: string;
    }>;

    const clicksByButton: Record<string, number> = {};
    for (const c of clicksLog) {
      const key = c.buttonId || c.targetUrl || 'direct';
      clicksByButton[key] = (clicksByButton[key] || 0) + 1;
    }

    return {
      ...summary,
      theme: (link.theme as unknown as SmartLinkTheme) || DEFAULT_THEME,
      buttonLinks: (link.buttonLinks as unknown as SmartLinkButton[]) || [],
      shoppableGrid: (link.shoppableGrid as unknown as ShoppableGridItem[]) || [],
      socialLinks: (link.socialLinks as unknown as SmartLinkSocialItem[]) || [],
      analytics: {
        totalViews: link.viewCount,
        totalClicks: link.clickCount,
        ctr: summary.ctr,
        clicksByButton,
        recentClicks: clicksLog.slice(-50).reverse(),
      },
    };
  }

  async update(id: string, input: Valid<typeof UpdateSmartLinkBody>): Promise<SmartLinkSummary> {
    const existing = await this.prisma.smartLink.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.smartLinkNotFound,
        'SmartLink not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    let slug = existing.slug;
    if (input.slug && input.slug.trim().toLowerCase() !== existing.slug) {
      slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const taken = await this.tenancy.withoutCompanyScope(
        'marketing.smart_link.check_slug',
        async () => {
          return (this.prisma as any).smartLink.findUnique({
            where: { slug },
          });
        },
      );
      if (taken && taken.id !== id) {
        throw new ApiException(
          MARKETING_ERROR_CODES.smartLinkSlugTaken,
          `Slug '${slug}' is already taken.`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const updated = await this.prisma.smartLink.update({
      where: { id },
      data: {
        campaignId: input.campaignId !== undefined ? input.campaignId || null : undefined,
        slug,
        title: input.title !== undefined ? input.title.trim() : undefined,
        bio: input.bio !== undefined ? input.bio?.trim() || null : undefined,
        avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl?.trim() || null : undefined,
        theme: input.theme !== undefined ? (input.theme as any) : undefined,
        buttonLinks: input.buttonLinks !== undefined ? (input.buttonLinks as any) : undefined,
        shoppableGrid: input.shoppableGrid !== undefined ? (input.shoppableGrid as any) : undefined,
        socialLinks: input.socialLinks !== undefined ? (input.socialLinks as any) : undefined,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
      },
    });

    return this.toSummary(updated);
  }

  async delete(id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.smartLink.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.smartLinkNotFound,
        'SmartLink not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.smartLink.delete({
      where: { id },
    });

    return { deleted: true };
  }

  // ─── Public Bio Page Serving & Click Analytics ──────────────────────────────────────

  async getPublicPage(slug: string): Promise<any> {
    return this.tenancy.withoutCompanyScope(
      'marketing.smart_link.public_view',
      async () => {
        const link = await (this.prisma as any).smartLink.findUnique({
          where: { slug: slug.toLowerCase() },
        });

        if (!link || !link.isActive) {
          throw new ApiException(
            MARKETING_ERROR_CODES.smartLinkNotFound,
            'Bio page not found or currently inactive.',
            HttpStatus.NOT_FOUND,
          );
        }

        // Increment view count atomically
        const updated = await (this.prisma as any).smartLink.update({
          where: { id: link.id },
          data: {
            viewCount: { increment: 1 },
          },
        });

        return updated;
      },
    );
  }

  async recordPublicClick(
    slug: string,
    req: RecordSmartLinkClickRequest,
    meta?: { userAgent?: string; referer?: string },
  ): Promise<{ recorded: boolean; targetUrl?: string }> {
    return this.tenancy.withoutCompanyScope(
      'marketing.smart_link.public_click',
      async () => {
        const link = await (this.prisma as any).smartLink.findUnique({
          where: { slug: slug.toLowerCase() },
        });

        if (!link || !link.isActive) {
          throw new ApiException(
            MARKETING_ERROR_CODES.smartLinkNotFound,
            'Bio page not found.',
            HttpStatus.NOT_FOUND,
          );
        }

        const buttons = (Array.isArray(link.buttonLinks) ? link.buttonLinks : []) as SmartLinkButton[];
        const grid = (Array.isArray(link.shoppableGrid) ? link.shoppableGrid : []) as ShoppableGridItem[];
        const clicks = (Array.isArray(link.clicks) ? link.clicks : []) as any[];

        let targetUrl = req.targetUrl;

        // If button clicked, increment its clicks count
        if (req.buttonId) {
          const btn = buttons.find((b) => b.id === req.buttonId);
          if (btn) {
            btn.clicks = (btn.clicks || 0) + 1;
            targetUrl = targetUrl || btn.url;
          }
        }

        // If grid item clicked, increment its clicks count
        if (req.itemId) {
          const item = grid.find((g) => g.id === req.itemId);
          if (item) {
            item.clicks = (item.clicks || 0) + 1;
            targetUrl = targetUrl || item.productUrl;
          }
        }

        // Append click event
        clicks.push({
          timestamp: new Date().toISOString(),
          buttonId: req.buttonId || null,
          targetUrl: targetUrl || null,
          referer: meta?.referer?.slice(0, 255) || null,
        });

        // Limit clicks history to recent 500 items
        const prunedClicks = clicks.slice(-500);

        await (this.prisma as any).smartLink.update({
          where: { id: link.id },
          data: {
            clickCount: { increment: 1 },
            buttonLinks: buttons as any,
            shoppableGrid: grid as any,
            clicks: prunedClicks as any,
          },
        });

        return { recorded: true, targetUrl };
      },
    );
  }

  /**
   * The public page, assembled.
   *
   * Two rules hold this together, and they are ordered. First, everything here was validated at
   * the *write* boundary, so the renderer is not the control — it is the last line. Second, the
   * renderer still trusts nothing it reads back: these are JSON columns that were untyped until
   * this ticket, so rows predating the validation exist and one of them must not be able to take
   * the page down. A malformed entry costs its own card and nothing else.
   *
   * `nonce` comes from the controller, one CSPRNG value per response. It is the only thing
   * standing between a future escaping mistake and a working script, which is exactly why it
   * sits behind the validation rather than in place of it.
   */
  renderHtml(smartLink: any, nonce = ''): string {
    const theme = this.safeTheme(smartLink.theme);

    const buttons = this.safeButtons(smartLink.buttonLinks);
    const grid = this.safeGrid(smartLink.shoppableGrid);
    const socials = this.safeSocials(smartLink.socialLinks);

    const buttonsHtml = buttons
      .map((b) => {
        return `
        <a href="${this.escapeHtml(b.url)}" target="_blank" rel="noopener noreferrer" class="smart-btn" data-id="${this.escapeHtml(b.id)}">
          ${b.icon ? `<span class="btn-icon">${this.escapeHtml(b.icon)}</span>` : ''}
          <span class="btn-title">${this.escapeHtml(b.title)}</span>
          <span class="btn-arrow">↗</span>
        </a>`;
      })
      .join('\n');

    const gridHtml =
      grid.length > 0
        ? `
      <div class="grid-section">
        <h3 class="section-title">Shop The Feed</h3>
        <div class="shoppable-grid">
          ${grid
            .map((item) => {
              return `
              <a href="${this.escapeHtml(item.productUrl)}" target="_blank" rel="noopener noreferrer" class="grid-item" data-item-id="${this.escapeHtml(item.id)}">
                <img src="${this.escapeHtml(item.imageUrl)}" alt="${this.escapeHtml(item.title || 'Product')}" loading="lazy" />
                ${item.price ? `<span class="grid-badge">${this.escapeHtml(item.price)}</span>` : ''}
              </a>`;
            })
            .join('\n')}
        </div>
      </div>`
        : '';

    const socialsHtml =
      socials.length > 0
        ? `
      <div class="social-tray">
        ${socials
          .map((s) => {
            return `<a href="${this.escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="social-link" title="${this.escapeHtml(s.platform)}">
              <span>${this.escapeHtml(s.platform.toUpperCase())}</span>
            </a>`;
          })
          .join('\n')}
      </div>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${this.escapeHtml(smartLink.title)}</title>
  <meta name="description" content="${this.escapeHtml(smartLink.bio || smartLink.title)}">
  <meta property="og:title" content="${this.escapeHtml(smartLink.title)}">
  <meta property="og:description" content="${this.escapeHtml(smartLink.bio || '')}">
  ${smartLink.avatarUrl ? `<meta property="og:image" content="${this.escapeHtml(smartLink.avatarUrl)}">` : ''}
  <style${nonce ? ` nonce="${this.escapeHtml(nonce)}"` : ''}>
    :root {
      --primary: ${theme.primaryColor};
      --bg: ${theme.backgroundColor};
      --text: ${theme.textColor};
      --font: ${FONT_STACKS[theme.fontFamily ?? 'system'] ?? FONT_STACKS.system};
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2.5rem 1rem;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }
    .bio-container {
      width: 100%;
      max-width: 480px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
    }
    .avatar {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      object-fit: cover;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      border: 3px solid var(--primary);
    }
    .profile-title {
      font-size: 1.5rem;
      font-weight: 700;
      text-align: center;
      letter-spacing: -0.02em;
    }
    .profile-bio {
      font-size: 0.95rem;
      opacity: 0.85;
      text-align: center;
      max-width: 380px;
      line-height: 1.45;
    }
    .buttons-container {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      margin-top: 0.5rem;
    }
    .smart-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 1rem 1.25rem;
      background: rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 14px;
      color: inherit;
      text-decoration: none;
      font-weight: 600;
      font-size: 1rem;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .smart-btn:hover {
      transform: translateY(-2px);
      background: rgba(255, 255, 255, 0.16);
      border-color: var(--primary);
      box-shadow: 0 8px 20px rgba(0,0,0,0.2);
    }
    .btn-icon {
      font-size: 1.2rem;
      margin-right: 0.5rem;
    }
    .btn-title {
      flex: 1;
      text-align: center;
    }
    .btn-arrow {
      opacity: 0.6;
      font-size: 0.9rem;
    }
    .grid-section {
      width: 100%;
      margin-top: 1.5rem;
    }
    .section-title {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.7;
      margin-bottom: 0.75rem;
      text-align: center;
    }
    .shoppable-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      width: 100%;
    }
    .grid-item {
      position: relative;
      aspect-ratio: 1 / 1;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      transition: transform 0.2s ease;
    }
    .grid-item:hover {
      transform: scale(1.03);
    }
    .grid-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .grid-badge {
      position: absolute;
      bottom: 6px;
      right: 6px;
      background: rgba(0,0,0,0.75);
      color: #fff;
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 6px;
      font-weight: 700;
    }
    .social-tray {
      display: flex;
      gap: 1rem;
      justify-content: center;
      margin-top: 1.5rem;
      flex-wrap: wrap;
    }
    .social-link {
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: inherit;
      text-decoration: none;
      opacity: 0.7;
      padding: 6px 12px;
      border-radius: 20px;
      background: rgba(255,255,255,0.06);
      transition: opacity 0.2s ease;
    }
    .social-link:hover {
      opacity: 1;
      background: rgba(255,255,255,0.15);
    }
    .footer-brand {
      margin-top: 2.5rem;
      font-size: 0.75rem;
      opacity: 0.5;
    }
  </style>
</head>
<body>
  <div class="bio-container">
    ${smartLink.avatarUrl ? `<img src="${this.escapeHtml(smartLink.avatarUrl)}" alt="${this.escapeHtml(smartLink.title)}" class="avatar" />` : ''}
    <h1 class="profile-title">${this.escapeHtml(smartLink.title)}</h1>
    ${smartLink.bio ? `<p class="profile-bio">${this.escapeHtml(smartLink.bio)}</p>` : ''}
    
    <div class="buttons-container">
      ${buttonsHtml}
    </div>

    ${gridHtml}
    ${socialsHtml}

    <div class="footer-brand">
      Powered by SmartLinks
    </div>
  </div>

  <script${nonce ? ` nonce="${this.escapeHtml(nonce)}"` : ''}>
    // Real-time click beaconing
    document.querySelectorAll('.smart-btn').forEach(function(el) {
      el.addEventListener('click', function() {
        var id = el.getAttribute('data-id');
        var targetUrl = el.getAttribute('href');
        navigator.sendBeacon('/b/${this.escapeHtml(smartLink.slug)}/clicks', JSON.stringify({ buttonId: id, targetUrl: targetUrl }));
      });
    });
    document.querySelectorAll('.grid-item').forEach(function(el) {
      el.addEventListener('click', function() {
        var itemId = el.getAttribute('data-item-id');
        var targetUrl = el.getAttribute('href');
        navigator.sendBeacon('/b/${this.escapeHtml(smartLink.slug)}/clicks', JSON.stringify({ itemId: itemId, targetUrl: targetUrl }));
      });
    });
  </script>
</body>
</html>`;
  }

  /**
   * Escapes anything, including things that are not strings.
   *
   * It used to take `string` and call `.replace` on it, which is a 500 on a public page the
   * moment one legacy JSON row holds a number or a `null` — and legacy rows exist precisely
   * because these columns were never typed. Coercing costs nothing and removes a whole class of
   * outage from a page nobody has to be signed in to reach.
   */
  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * The read path's assertions.
   *
   * These are not the control — `schemas.ts` is, at write time. What they do is refuse to render
   * a row that predates it. A URL that no longer passes drops its own card; a colour that does
   * not falls back to the default. Nothing here coerces a *new* write into acceptability,
   * because nothing here runs on the write path.
   */
  private safeUrl(value: unknown): string | undefined {
    const read = readLinkUrl(value, 'url');
    if (read.ok) return read.value;
    this.logger.warn(`Bio page dropped a link that is not a permitted URL: ${String(value)}`);
    return undefined;
  }

  private safeTheme(stored: unknown): SmartLinkTheme {
    const given =
      typeof stored === 'object' && stored !== null && !Array.isArray(stored)
        ? (stored as Record<string, unknown>)
        : {};

    const colour = (key: 'primaryColor' | 'backgroundColor' | 'textColor'): string => {
      const value = given[key];
      return typeof value === 'string' && SMART_LINK_COLOR_PATTERN.test(value.trim())
        ? value.trim()
        : DEFAULT_THEME[key];
    };

    const fontFamily =
      typeof given.fontFamily === 'string' && given.fontFamily in FONT_STACKS
        ? (given.fontFamily as SmartLinkTheme['fontFamily'])
        : DEFAULT_THEME.fontFamily;

    const cardStyle =
      given.cardStyle === 'flat' ||
      given.cardStyle === 'rounded' ||
      given.cardStyle === 'glassmorphism' ||
      given.cardStyle === 'shadow'
        ? given.cardStyle
        : DEFAULT_THEME.cardStyle;

    return {
      primaryColor: colour('primaryColor'),
      backgroundColor: colour('backgroundColor'),
      textColor: colour('textColor'),
      cardStyle,
      fontFamily,
    };
  }

  private safeButtons(stored: unknown): SmartLinkButton[] {
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
      const entry = item as Record<string, unknown>;
      const url = this.safeUrl(entry.url);
      if (!url || typeof entry.title !== 'string') return [];
      return [
        {
          id: typeof entry.id === 'string' ? entry.id : '',
          title: entry.title,
          url,
          ...(typeof entry.icon === 'string' ? { icon: entry.icon } : {}),
        } as SmartLinkButton,
      ];
    });
  }

  private safeGrid(stored: unknown): ShoppableGridItem[] {
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
      const entry = item as Record<string, unknown>;
      const productUrl = this.safeUrl(entry.productUrl);
      const imageUrl = this.safeUrl(entry.imageUrl);
      if (!productUrl || !imageUrl) return [];
      return [
        {
          id: typeof entry.id === 'string' ? entry.id : '',
          productUrl,
          imageUrl,
          ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
          ...(typeof entry.price === 'string' ? { price: entry.price } : {}),
        } as ShoppableGridItem,
      ];
    });
  }

  private safeSocials(stored: unknown): SmartLinkSocialItem[] {
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
      const entry = item as Record<string, unknown>;
      const url = this.safeUrl(entry.url);
      if (!url || typeof entry.platform !== 'string') return [];
      return [{ platform: entry.platform, url }];
    });
  }

  private toSummary(l: any): SmartLinkSummary {
    const views = l.viewCount || 0;
    const clicks = l.clickCount || 0;
    const ctr = views > 0 ? Number(((clicks / views) * 100).toFixed(2)) : 0;
    const buttons = Array.isArray(l.buttonLinks) ? l.buttonLinks : [];
    const grid = Array.isArray(l.shoppableGrid) ? l.shoppableGrid : [];

    return {
      id: l.id,
      brandId: l.brandId,
      campaignId: l.campaignId ?? null,
      slug: l.slug,
      title: l.title,
      bio: l.bio ?? null,
      avatarUrl: l.avatarUrl ?? null,
      viewCount: views,
      clickCount: clicks,
      ctr,
      isActive: l.isActive,
      buttonLinksCount: buttons.length,
      shoppableGridCount: grid.length,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    };
  }
}
