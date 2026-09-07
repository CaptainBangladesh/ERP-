import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MARKETING_ERROR_CODES,
  type BrandColors,
  type BrandDetailResponse,
  type BrandListResponse,
  type BrandMemberRole,
  type BrandMemberSummary,
  type BrandSummary,
  type SocialAccountSummary,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { defined } from '../../prisma/columns';
import { SnippetsService } from './snippets.service';
import { SocialAccountsService } from './social-accounts.service';
import {
  AddBrandMemberBody,
  BRAND_LIST,
  CreateBrandBody,
  UpdateBrandBody,
} from './schemas';

@Injectable()
export class BrandsService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly accounts: SocialAccountsService,
    private readonly snippets: SnippetsService,
  ) {}

  async createBrand(
    input: Valid<typeof CreateBrandBody>,
    creatorUserId?: string,
  ): Promise<BrandSummary> {
    const slug = (input.slug || slugify(input.name)).toLowerCase();

    // Check slug uniqueness within company
    const existing = await this.prisma.marketingBrand.findFirst({
      where: { slug },
    });
    if (existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.brandSlugTaken,
        `A brand with slug '${slug}' already exists in your company.`,
        HttpStatus.CONFLICT,
      );
    }

    const brand = await this.prisma.marketingBrand.create({
      data: companyApplied<Prisma.MarketingBrandUncheckedCreateInput>({
        name: input.name,
        slug,
        logoUrl: input.logoUrl,
        brandColors: input.brandColors ? (input.brandColors as Prisma.InputJsonValue) : Prisma.JsonNull,
        timezone: input.timezone || 'UTC',
        customDomain: input.customDomain,
        storageQuotaMb: input.storageQuotaMb || 1000,
        settings: input.settings ? (input.settings as Prisma.InputJsonValue) : Prisma.JsonNull,
      }),
      include: {
        _count: { select: { socialAccounts: true } },
      },
    });

    // Automatically assign the creating user as brand lead
    if (creatorUserId) {
      await this.prisma.brandMember.create({
        data: companyApplied<Prisma.BrandMemberUncheckedCreateInput>({
          brandId: brand.id,
          userId: creatorUserId,
          role: 'lead',
        }),
      });
    }

    // A snippet library nobody has filled in is a blank panel the first time the composer is
    // opened, so the brand starts with the public starter set (14.4). Idempotent by label.
    await this.snippets.seedStarterSnippets(brand.id);

    return describeBrand(brand);
  }

  async listBrands(query: Record<string, unknown>): Promise<BrandListResponse> {
    const slice = listQuery(query, BRAND_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.marketingBrand.findMany({
        ...slice.findMany<Prisma.MarketingBrandFindManyArgs>(),
        include: {
          _count: { select: { socialAccounts: true } },
        },
      }),
      this.prisma.marketingBrand.count(slice.count<Prisma.MarketingBrandCountArgs>()),
    ]);

    return slice.respond(rows.map(describeBrand), total);
  }

  async getBrandDetail(id: string): Promise<BrandDetailResponse> {
    const brand = await this.prisma.marketingBrand.findFirst({
      where: { id },
      include: {
        _count: { select: { socialAccounts: true } },
        members: true,
        socialAccounts: true,
      },
    });

    if (!brand) throw brandNotFound();

    /**
     * Rendered by `social-accounts.service`, not here.
     *
     * This used to be a second copy of that mapping, and its mask read the stored
     * `encryptedAccessToken` column — so the four "last characters of the token" the vault
     * screen showed were the tail of a GCM auth tag. 11.4a fixed the copy in
     * `social-accounts.service` and could not fix this one, because it did not know it
     * existed. Ciphertext never leaves the service layer, and there is now one mapping that
     * has to honour that rather than two that each might.
     */
    const maskedSocialAccounts: SocialAccountSummary[] = brand.socialAccounts.map((account) =>
      this.accounts.describeAccount(account),
    );

    const members: BrandMemberSummary[] = brand.members.map((m) => ({
      id: m.id,
      brandId: m.brandId,
      userId: m.userId,
      role: m.role as BrandMemberRole,
      createdAt: m.createdAt.toISOString(),
    }));

    return {
      ...describeBrand(brand),
      settings: brand.settings as Record<string, unknown> | null,
      members,
      socialAccounts: maskedSocialAccounts,
    };
  }

  async updateBrand(
    id: string,
    input: Valid<typeof UpdateBrandBody>,
  ): Promise<BrandSummary> {
    const existing = await this.prisma.marketingBrand.findFirst({ where: { id } });
    if (!existing) throw brandNotFound();

    if (input.slug && input.slug !== existing.slug) {
      const slugTaken = await this.prisma.marketingBrand.findFirst({
        where: { slug: input.slug, id: { not: id } },
      });
      if (slugTaken) {
        throw new ApiException(
          MARKETING_ERROR_CODES.brandSlugTaken,
          `A brand with slug '${input.slug}' already exists in your company.`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const updated = await this.prisma.marketingBrand.update({
      where: { id },
      data: {
        ...defined('name', input.name),
        ...defined('slug', input.slug?.toLowerCase()),
        ...defined('logoUrl', input.logoUrl),
        ...(input.brandColors !== undefined
          ? { brandColors: input.brandColors as Prisma.InputJsonValue }
          : {}),
        ...defined('timezone', input.timezone),
        ...defined('customDomain', input.customDomain),
        ...defined('storageQuotaMb', input.storageQuotaMb),
        ...(input.settings !== undefined
          ? { settings: input.settings as Prisma.InputJsonValue }
          : {}),
      },
      include: {
        _count: { select: { socialAccounts: true } },
      },
    });

    return describeBrand(updated);
  }

  async deleteBrand(id: string): Promise<void> {
    const existing = await this.prisma.marketingBrand.findFirst({ where: { id } });
    if (!existing) throw brandNotFound();

    await this.prisma.marketingBrand.delete({ where: { id } });
  }

  async addMember(
    brandId: string,
    input: Valid<typeof AddBrandMemberBody>,
  ): Promise<BrandMemberSummary> {
    const brand = await this.prisma.marketingBrand.findFirst({ where: { id: brandId } });
    if (!brand) throw brandNotFound();

    const existingMember = await this.prisma.brandMember.findFirst({
      where: { brandId, userId: input.userId },
    });
    if (existingMember) {
      throw new ApiException(
        MARKETING_ERROR_CODES.memberAlreadyExists,
        'That user is already a member of this brand.',
        HttpStatus.CONFLICT,
      );
    }

    const member = await this.prisma.brandMember.create({
      data: companyApplied<Prisma.BrandMemberUncheckedCreateInput>({
        brandId,
        userId: input.userId,
        role: input.role || 'editor',
      }),
    });

    return {
      id: member.id,
      brandId: member.brandId,
      userId: member.userId,
      role: member.role as BrandMemberRole,
      createdAt: member.createdAt.toISOString(),
    };
  }

  async removeMember(brandId: string, userId: string): Promise<void> {
    const member = await this.prisma.brandMember.findFirst({
      where: { brandId, userId },
    });
    if (!member) {
      throw new ApiException(
        MARKETING_ERROR_CODES.memberNotFound,
        'That member does not exist in this brand.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.brandMember.delete({ where: { id: member.id } });
  }

  async listMembers(brandId: string): Promise<BrandMemberSummary[]> {
    const members = await this.prisma.brandMember.findMany({
      where: { brandId },
    });

    return members.map((m) => ({
      id: m.id,
      brandId: m.brandId,
      userId: m.userId,
      role: m.role as BrandMemberRole,
      createdAt: m.createdAt.toISOString(),
    }));
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function describeBrand(
  row: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    brandColors: unknown;
    timezone: string;
    customDomain: string | null;
    storageQuotaMb: number;
    createdAt: Date;
    updatedAt: Date;
    _count?: { socialAccounts: number };
  },
): BrandSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logoUrl,
    brandColors: (row.brandColors as BrandColors) ?? null,
    timezone: row.timezone,
    customDomain: row.customDomain,
    storageQuotaMb: row.storageQuotaMb,
    socialAccountsCount: row._count?.socialAccounts ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function brandNotFound(): ApiException {
  return new ApiException(
    MARKETING_ERROR_CODES.brandNotFound,
    'That brand does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
