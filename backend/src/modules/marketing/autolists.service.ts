import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MARKETING_ERROR_CODES,
  type AutolistDetailResponse,
  type AutolistItemResponse,
  type AutolistItemSummary,
  type AutolistListResponse,
  type AutolistRepeatMode,
  type AutolistSlot,
  type AutolistStatus,
  type AutolistSummary,
  type AutolistTraversalMode,
  type CreateAutolistItemRequest,
  type CreateAutolistRequest,
  type CycleAutolistResponse,
  type UpdateAutolistItemRequest,
  type UpdateAutolistRequest,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { defined } from '../../prisma/columns';
import { IJobQueue, JOB_QUEUE_TOKEN } from './job-queue.interface';
import {
  AUTOLIST_LIST,
  CreateAutolistBody,
  CreateAutolistItemBody,
  UpdateAutolistBody,
  UpdateAutolistItemBody,
} from './schemas';

@Injectable()
export class AutolistsService implements OnModuleInit {
  private readonly logger = new Logger(AutolistsService.name);

  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    @Inject(JOB_QUEUE_TOKEN) private readonly jobQueue: IJobQueue,
  ) {}

  onModuleInit(): void {
    this.jobQueue.registerHandler('cycle_autolist', async (job) => {
      const autolistId = job.payload.autolistId as string;
      if (!autolistId) {
        throw new Error('cycle_autolist payload missing autolistId');
      }
      this.logger.log(`Worker executing cycle_autolist for autolist: ${autolistId}`);
      await this.cycleAutolist(autolistId);
    });
  }

  /**
   * Creates a new evergreen Autolist queue bucket.
   */
  async createAutolist(
    input: CreateAutolistRequest | Valid<typeof CreateAutolistBody>,
  ): Promise<AutolistSummary> {
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

    const autolist = await this.prisma.autolist.create({
      data: companyApplied<Prisma.AutolistUncheckedCreateInput>({
        brandId: input.brandId,
        name: input.name,
        description: input.description,
        repeatMode: input.repeatMode ?? 'RECYCLE',
        traversalMode: input.traversalMode ?? 'FIFO',
        activeSlots: input.activeSlots as unknown as Prisma.InputJsonValue,
        collisionWindowMinutes: input.collisionWindowMinutes ?? 90,
        status: 'ACTIVE',
      }),
      include: {
        _count: { select: { items: true } },
      },
    });

    return this.toSummary(autolist);
  }

  /**
   * Updates an existing Autolist.
   */
  async updateAutolist(
    id: string,
    input: UpdateAutolistRequest | Valid<typeof UpdateAutolistBody>,
  ): Promise<AutolistSummary> {
    const existing = await this.prisma.autolist.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.autolistNotFound,
        'Autolist not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const updated = await this.prisma.autolist.update({
      where: { id },
      data: {
        ...defined('name', input.name),
        ...defined('description', input.description),
        ...defined('repeatMode', input.repeatMode),
        ...defined('traversalMode', input.traversalMode),
        ...(input.activeSlots !== undefined
          ? { activeSlots: input.activeSlots as unknown as Prisma.InputJsonValue }
          : {}),
        ...defined('status', input.status),
        ...defined('collisionWindowMinutes', input.collisionWindowMinutes),
      },
      include: {
        _count: { select: { items: true } },
      },
    });

    return this.toSummary(updated);
  }

  /**
   * Retrieves an Autolist with its items.
   */
  async getAutolist(id: string): Promise<AutolistDetailResponse> {
    const autolist = await this.prisma.autolist.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { orderIndex: 'asc' },
        },
        _count: { select: { items: true } },
      },
    });

    if (!autolist) {
      throw new ApiException(
        MARKETING_ERROR_CODES.autolistNotFound,
        'Autolist not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      ...this.toSummary(autolist),
      items: autolist.items.map((item) => this.toItemSummary(item)),
    };
  }

  /**
   * Lists Autolists with paging and filtering.
   */
  async listAutolists(query: Record<string, unknown>): Promise<AutolistListResponse> {
    const slice = listQuery(query, AUTOLIST_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.autolist.findMany({
        ...slice.findMany<Prisma.AutolistFindManyArgs>(),
        include: { _count: { select: { items: true } } },
      }),
      this.prisma.autolist.count(slice.count<Prisma.AutolistCountArgs>()),
    ]);

    return slice.respond(rows.map((row) => this.toSummary(row)), total);
  }

  /**
   * Deletes an Autolist.
   */
  async deleteAutolist(id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.autolist.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.autolistNotFound,
        'Autolist not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.autolist.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Autolist Items ─────────────────────────────────────────────────────────────

  /**
   * Adds a content item to an Autolist bucket.
   */
  async addItem(
    autolistId: string,
    input: CreateAutolistItemRequest | Valid<typeof CreateAutolistItemBody>,
  ): Promise<AutolistItemResponse> {
    const autolist = await this.prisma.autolist.findUnique({
      where: { id: autolistId },
    });
    if (!autolist) {
      throw new ApiException(
        MARKETING_ERROR_CODES.autolistNotFound,
        'Autolist not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Determine next orderIndex if not provided
    let orderIndex = input.orderIndex;
    if (orderIndex === undefined) {
      const highest = await this.prisma.autolistItem.findFirst({
        where: { autolistId },
        orderBy: { orderIndex: 'desc' },
      });
      orderIndex = (highest?.orderIndex ?? -1) + 1;
    }

    const item = await this.prisma.autolistItem.create({
      data: companyApplied<Prisma.AutolistItemUncheckedCreateInput>({
        autolistId,
        content: input.content,
        mediaUrls: input.mediaUrls ? (input.mediaUrls as Prisma.InputJsonValue) : Prisma.JsonNull,
        platformConfig: input.platformConfig
          ? (input.platformConfig as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        orderIndex,
        publishCount: 0,
        status: 'ACTIVE',
      }),
    });

    return this.toItemSummary(item);
  }

  /**
   * Updates an item in an Autolist bucket.
   */
  async updateItem(
    autolistId: string,
    itemId: string,
    input: UpdateAutolistItemRequest | Valid<typeof UpdateAutolistItemBody>,
  ): Promise<AutolistItemResponse> {
    const item = await this.prisma.autolistItem.findFirst({
      where: { id: itemId, autolistId },
    });
    if (!item) {
      throw new ApiException(
        MARKETING_ERROR_CODES.autolistItemNotFound,
        'Autolist item not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const updated = await this.prisma.autolistItem.update({
      where: { id: itemId },
      data: {
        ...defined('content', input.content),
        ...(input.mediaUrls !== undefined
          ? { mediaUrls: input.mediaUrls as Prisma.InputJsonValue }
          : {}),
        ...(input.platformConfig !== undefined
          ? { platformConfig: input.platformConfig as Prisma.InputJsonValue }
          : {}),
        ...defined('orderIndex', input.orderIndex),
        ...defined('status', input.status),
      },
    });

    return this.toItemSummary(updated);
  }

  /**
   * Deletes an item from an Autolist bucket.
   */
  async deleteItem(autolistId: string, itemId: string): Promise<{ deleted: boolean }> {
    const item = await this.prisma.autolistItem.findFirst({
      where: { id: itemId, autolistId },
    });
    if (!item) {
      throw new ApiException(
        MARKETING_ERROR_CODES.autolistItemNotFound,
        'Autolist item not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.autolistItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  // ─── Queue Cycling & Traversal Algorithms ───────────────────────────────────────

  /**
   * Cycles an Autolist: picks the next eligible item according to traversal rules (FIFO or SHUFFLE),
   * applies the 90-minute collision buffer check, creates the ScheduledPost, and enqueues publish.
   */
  async cycleAutolist(
    autolistId: string,
    referenceTime: Date = new Date(),
  ): Promise<CycleAutolistResponse> {
    const autolist = await this.prisma.autolist.findUnique({
      where: { id: autolistId },
      include: {
        brand: {
          include: { socialAccounts: true },
        },
        items: {
          where: { status: 'ACTIVE' },
        },
      },
    });

    if (!autolist) {
      throw new ApiException(
        MARKETING_ERROR_CODES.autolistNotFound,
        'Autolist not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (autolist.status !== 'ACTIVE') {
      return {
        cycled: false,
        message: `Autolist is currently ${autolist.status}.`,
      };
    }

    if (autolist.items.length === 0) {
      throw new ApiException(
        MARKETING_ERROR_CODES.autolistEmpty,
        'Autolist has no active items to publish.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 1. Select the next item based on traversal mode
    const chosenItem = this.selectNextItem(autolist.items, autolist.traversalMode as AutolistTraversalMode);

    // 2. Calculate next active time slot
    const slots = (autolist.activeSlots as unknown as AutolistSlot[]) ?? [];
    if (slots.length === 0) {
      return {
        cycled: false,
        message: 'Autolist has no configured active slots.',
      };
    }

    const nextSlotTime = this.findNextSlotTime(slots, referenceTime);

    // 3. Resolve target social account(s)
    const activeAccounts = autolist.brand.socialAccounts.filter((a) => a.status === 'active');
    if (activeAccounts.length === 0) {
      return {
        cycled: false,
        message: 'No active connected social accounts available for this brand.',
      };
    }

    // Pick first matching account or first available
    const targetAccount = activeAccounts[0]!;

    // 4. Collision buffer check (default 90-minute window)
    const finalScheduledAt = await this.resolveCollisionWindow(
      targetAccount.id,
      nextSlotTime,
      autolist.collisionWindowMinutes,
    );

    // 5. Create ScheduledPost
    const post = await this.prisma.scheduledPost.create({
      data: companyApplied<Prisma.ScheduledPostUncheckedCreateInput>({
        brandId: autolist.brandId,
        socialAccountId: targetAccount.id,
        autolistItemId: chosenItem.id,
        content: chosenItem.content,
        mediaUrls: chosenItem.mediaUrls ? (chosenItem.mediaUrls as Prisma.InputJsonValue) : Prisma.JsonNull,
        platformConfig: chosenItem.platformConfig
          ? (chosenItem.platformConfig as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        scheduledAt: finalScheduledAt,
        status: 'SCHEDULED',
      }),
    });

    // 6. Enqueue publishing task
    await this.jobQueue.schedule({
      type: 'publish_social_post',
      payload: {
        postId: post.id,
        brandId: post.brandId,
        socialAccountId: post.socialAccountId,
      },
      scheduledAt: post.scheduledAt,
    });

    this.logger.log(
      `Autolist ${autolist.id} cycled: scheduled item ${chosenItem.id} for post ${post.id} at ${finalScheduledAt.toISOString()}`,
    );

    return {
      cycled: true,
      scheduledPostId: post.id,
      autolistItemId: chosenItem.id,
      scheduledAt: finalScheduledAt.toISOString(),
    };
  }

  /**
   * Selects next item according to FIFO or SHUFFLE (Story 21: every post published once before repeating).
   */
  private selectNextItem<
    T extends {
      id: string;
      orderIndex: number;
      publishCount: number;
      lastPublishedAt: Date | null;
      createdAt: Date;
    },
  >(items: T[], traversalMode: AutolistTraversalMode): T {
    if (traversalMode === 'FIFO') {
      // Sort by publishCount ascending, then orderIndex ascending, then createdAt ascending
      const sorted = [...items].sort((a, b) => {
        if (a.publishCount !== b.publishCount) return a.publishCount - b.publishCount;
        if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      return sorted[0]!;
    } else {
      // SHUFFLE traversal (Story 21):
      // Find the minimum publish count among all items.
      const minPublishCount = Math.min(...items.map((i) => i.publishCount));
      // Filter items that have this minimum count (the un-exhausted round)
      const candidates = items.filter((i) => i.publishCount === minPublishCount);
      // Pick a random element from candidates
      const randomIndex = Math.floor(Math.random() * candidates.length);
      return candidates[randomIndex]!;
    }
  }

  /**
   * Finds next upcoming slot timestamp based on weekly schedule matrix.
   */
  private findNextSlotTime(slots: AutolistSlot[], referenceTime: Date): Date {
    const currentDay = referenceTime.getDay(); // 0-6
    const currentHours = referenceTime.getHours();
    const currentMinutes = referenceTime.getMinutes();
    const currentTimeMinutes = currentHours * 60 + currentMinutes;

    // Sort slots by day and time
    const parsedSlots = slots.map((s) => {
      const [h, m] = s.time.split(':').map(Number);
      return {
        dayOfWeek: s.dayOfWeek,
        hours: h || 0,
        minutes: m || 0,
        timeMinutes: (h || 0) * 60 + (m || 0),
      };
    });

    // 1. Look for a slot later today
    const laterToday = parsedSlots.find(
      (s) => s.dayOfWeek === currentDay && s.timeMinutes > currentTimeMinutes + 5,
    );

    if (laterToday) {
      const d = new Date(referenceTime);
      d.setHours(laterToday.hours, laterToday.minutes, 0, 0);
      return d;
    }

    // 2. Look for the earliest slot in upcoming days (1 to 7 days ahead)
    for (let offset = 1; offset <= 7; offset++) {
      const checkDay = (currentDay + offset) % 7;
      const daySlots = parsedSlots
        .filter((s) => s.dayOfWeek === checkDay)
        .sort((a, b) => a.timeMinutes - b.timeMinutes);

      if (daySlots.length > 0) {
        const slot = daySlots[0]!;
        const d = new Date(referenceTime);
        d.setDate(d.getDate() + offset);
        d.setHours(slot.hours, slot.minutes, 0, 0);
        return d;
      }
    }

    // Fallback: 1 hour from now
    return new Date(referenceTime.getTime() + 60 * 60 * 1000);
  }

  /**
   * Checks collision window (e.g. 90 minutes) against existing scheduled posts on the target account.
   * If a conflict is found, bumps the scheduled time past the buffer.
   */
  private async resolveCollisionWindow(
    socialAccountId: string,
    targetDate: Date,
    bufferMinutes: number,
  ): Promise<Date> {
    const windowMs = bufferMinutes * 60 * 1000;
    let scheduledDate = new Date(targetDate);

    for (let attempt = 0; attempt < 5; attempt++) {
      const windowStart = new Date(scheduledDate.getTime() - windowMs);
      const windowEnd = new Date(scheduledDate.getTime() + windowMs);

      const conflict = await this.prisma.scheduledPost.findFirst({
        where: {
          socialAccountId,
          status: { in: ['SCHEDULED', 'PUBLISHING', 'PUBLISHED'] },
          scheduledAt: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
        orderBy: { scheduledAt: 'desc' },
      });

      if (!conflict) {
        // No conflict, safe to schedule
        return scheduledDate;
      }

      // Conflict found! Push time past conflict + buffer
      scheduledDate = new Date(conflict.scheduledAt.getTime() + windowMs + 60 * 1000);
      this.logger.log(
        `Collision avoidance: shifted scheduled post on account ${socialAccountId} to ${scheduledDate.toISOString()} (buffered by ${bufferMinutes}m)`,
      );
    }

    return scheduledDate;
  }

  private toSummary(row: {
    id: string;
    brandId: string;
    name: string;
    description: string | null;
    repeatMode: string;
    traversalMode: string;
    activeSlots: Prisma.JsonValue;
    status: string;
    collisionWindowMinutes: number;
    createdAt: Date;
    updatedAt: Date;
    _count?: { items: number };
  }): AutolistSummary {
    return {
      id: row.id,
      brandId: row.brandId,
      name: row.name,
      description: row.description,
      repeatMode: row.repeatMode as AutolistRepeatMode,
      traversalMode: row.traversalMode as AutolistTraversalMode,
      activeSlots: (row.activeSlots as unknown as AutolistSlot[]) ?? [],
      status: row.status as AutolistStatus,
      collisionWindowMinutes: row.collisionWindowMinutes,
      itemCount: row._count?.items ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toItemSummary(row: {
    id: string;
    autolistId: string;
    content: string;
    mediaUrls: Prisma.JsonValue | null;
    platformConfig: Prisma.JsonValue | null;
    orderIndex: number;
    publishCount: number;
    lastPublishedAt: Date | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): AutolistItemSummary {
    return {
      id: row.id,
      autolistId: row.autolistId,
      content: row.content,
      mediaUrls: Array.isArray(row.mediaUrls) ? (row.mediaUrls as string[]) : [],
      platformConfig: (row.platformConfig as Record<string, unknown>) ?? null,
      orderIndex: row.orderIndex,
      publishCount: row.publishCount,
      lastPublishedAt: row.lastPublishedAt?.toISOString() ?? null,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
