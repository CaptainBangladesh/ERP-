import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MARKETING_ERROR_CODES,
  type CreateScheduledPostRequest,
  type PublishPostResponse,
  type ScheduledPostListResponse,
  type ScheduledPostStatus,
  type ScheduledPostSummary,
  type SocialPlatform,
  type SyncMetricsResponse,
  type UpdateScheduledPostRequest,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { defined } from '../../prisma/columns';
import { SocialAdapterResolver } from './adapters/social-adapter.resolver';
import { CryptoService } from './crypto.service';
import { IJobQueue, JOB_QUEUE_TOKEN } from './job-queue.interface';
import { countAgainstQuota, publishingWindowFor } from './publishing-quota';
import {
  CreateScheduledPostBody,
  POST_LIST,
  UpdateScheduledPostBody,
} from './schemas';

@Injectable()
export class SocialPublisherService implements OnModuleInit {
  private readonly logger = new Logger(SocialPublisherService.name);

  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly crypto: CryptoService,
    private readonly adapterResolver: SocialAdapterResolver,
    @Inject(JOB_QUEUE_TOKEN) private readonly jobQueue: IJobQueue,
  ) {}

  onModuleInit(): void {
    this.jobQueue.registerHandler('publish_social_post', async (job) => {
      const postId = job.payload.postId as string;
      if (!postId) {
        throw new Error('publish_social_post payload missing postId');
      }
      this.logger.log(`Worker executing publish_social_post for post: ${postId}`);
      await this.publishPost(postId);
    });
  }

  /**
   * Schedules or drafts a new social post for one of the brand's connected channels.
   */
  async schedulePost(
    input: CreateScheduledPostRequest | Valid<typeof CreateScheduledPostBody>,
  ): Promise<ScheduledPostSummary> {
    // 1. Verify brand exists
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

    // 2. Verify social account exists under this brand
    const socialAccount = await this.prisma.socialAccount.findFirst({
      where: {
        id: input.socialAccountId,
        brandId: input.brandId,
      },
    });
    if (!socialAccount) {
      throw new ApiException(
        MARKETING_ERROR_CODES.socialAccountNotFound,
        'Social account not found under the selected brand.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Verify platform rate limits
    await this.enforcePublishingRateLimit(socialAccount.id, socialAccount.platform as SocialPlatform);

    const scheduledAt = new Date(input.scheduledAt);
    if (isNaN(scheduledAt.getTime())) {
      throw new ApiException('invalid_scheduled_at', 'Invalid scheduled timestamp.', HttpStatus.BAD_REQUEST);
    }

    const status: ScheduledPostStatus = input.status ?? 'SCHEDULED';

    const post = await this.prisma.scheduledPost.create({
      data: companyApplied<Prisma.ScheduledPostUncheckedCreateInput>({
        brandId: input.brandId,
        socialAccountId: input.socialAccountId,
        campaignId: input.campaignId,
        autolistItemId: input.autolistItemId,
        content: input.content,
        mediaUrls: input.mediaUrls ? (input.mediaUrls as Prisma.InputJsonValue) : Prisma.JsonNull,
        platformConfig: input.platformConfig
          ? (input.platformConfig as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        scheduledAt,
        status,
      }),
      include: {
        socialAccount: true,
      },
    });

    // 3. Enqueue background queue job if scheduled
    if (status === 'SCHEDULED') {
      await this.jobQueue.schedule({
        type: 'publish_social_post',
        payload: {
          postId: post.id,
          brandId: post.brandId,
          socialAccountId: post.socialAccountId,
        },
        scheduledAt: post.scheduledAt,
      });
    }

    this.logger.log(`Scheduled post created: ${post.id} (status: ${status}, scheduledAt: ${scheduledAt.toISOString()})`);
    return this.toSummary(post);
  }

  /**
   * Publishes a scheduled post immediately through the appropriate network adapter.
   */
  async publishPost(postId: string): Promise<PublishPostResponse> {
    const post = await this.prisma.scheduledPost.findUnique({
      where: { id: postId },
      include: {
        socialAccount: true,
      },
    });

    if (!post) {
      throw new ApiException(
        MARKETING_ERROR_CODES.postNotFound,
        'Scheduled post not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (post.status === 'PUBLISHED') {
      return {
        published: true,
        post: this.toSummary(post),
        externalPostId: post.externalPostId ?? undefined,
      };
    }

    if (post.status === 'CANCELLED') {
      throw new ApiException(
        MARKETING_ERROR_CODES.postNotPublishable,
        'Cannot publish a cancelled post.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Verify platform rate limits
    await this.enforcePublishingRateLimit(
      post.socialAccount.id,
      post.socialAccount.platform as SocialPlatform,
    );

    /**
     * Claim the row, conditionally — the same move the job queue makes.
     *
     * Reading `post.status` and then writing `PUBLISHING` in a second statement lets two
     * concurrent calls both pass the read and both reach the network, which is a duplicate post
     * on a client's real account: externally visible, and not undoable. The update's own `where`
     * is the check, so exactly one caller can win it.
     *
     * A `count === 0` means somebody else already has it. That is an ordinary outcome, not an
     * error — return what the other caller is in the middle of producing.
     */
    const claimed = await this.prisma.scheduledPost.updateMany({
      where: { id: postId, status: { in: PUBLISHABLE_STATES } },
      data: { status: 'PUBLISHING', failureReason: null },
    });

    if (claimed.count !== 1) {
      return {
        published: post.status === 'PUBLISHED',
        post: this.toSummary(post),
        externalPostId: post.externalPostId ?? undefined,
      };
    }

    // No network call above this line.
    try {
      // Decrypt access token
      const accessToken = this.crypto.decrypt(post.socialAccount.encryptedAccessToken);

      const adapter = this.adapterResolver.getAdapter(post.socialAccount.platform as SocialPlatform);

      const mediaUrls = Array.isArray(post.mediaUrls) ? (post.mediaUrls as string[]) : [];
      const platformConfig = (post.platformConfig as Record<string, unknown>) ?? undefined;

      // Recorded before the call, not after: an attempt that reaches the platform spends the
      // quota whether or not a response ever comes back.
      await this.prisma.scheduledPost.update({
        where: { id: postId },
        data: { networkAttemptedAt: new Date() },
      });

      const result = await adapter.publishPost({
        account: {
          platform: post.socialAccount.platform as SocialPlatform,
          platformAccountId: post.socialAccount.platformAccountId,
          accountName: post.socialAccount.accountName,
          accessToken,
        },
        content: post.content,
        mediaUrls,
        platformConfig,
      });

      const publishedAt = new Date();

      // Update post to PUBLISHED
      const updatedPost = await this.prisma.scheduledPost.update({
        where: { id: postId },
        data: {
          status: 'PUBLISHED',
          publishedAt,
          externalPostId: result.externalPostId,
          failureReason: null,
        },
        include: {
          socialAccount: true,
        },
      });

      // If associated with an autolist item, update item counters
      if (post.autolistItemId) {
        await this.prisma.autolistItem.update({
          where: { id: post.autolistItemId },
          data: {
            publishCount: { increment: 1 },
            lastPublishedAt: publishedAt,
          },
        }).catch((err) => {
          this.logger.warn(`Failed to update autolist item ${post.autolistItemId}: ${String(err)}`);
        });
      }

      this.logger.log(`Successfully published post ${postId} (externalPostId: ${result.externalPostId})`);

      return {
        published: true,
        post: this.toSummary(updatedPost),
        externalPostId: result.externalPostId,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Publish failed for post ${postId}: ${errorMsg}`);

      await this.prisma.scheduledPost.update({
        where: { id: postId },
        data: {
          status: 'FAILED',
          failureReason: errorMsg,
        },
      });

      throw new ApiException(
        MARKETING_ERROR_CODES.postPublishFailed,
        `Publishing to ${post.socialAccount.platform} failed: ${errorMsg}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Immediately triggers publish execution for a post.
   */
  async publishNow(postId: string): Promise<PublishPostResponse> {
    return this.publishPost(postId);
  }

  /**
   * Syncs latest organic and paid performance metrics from the third-party network.
   */
  async syncMetrics(postId: string): Promise<SyncMetricsResponse> {
    const post = await this.prisma.scheduledPost.findUnique({
      where: { id: postId },
      include: { socialAccount: true },
    });

    if (!post) {
      throw new ApiException(
        MARKETING_ERROR_CODES.postNotFound,
        'Scheduled post not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!post.externalPostId) {
      throw new ApiException(
        'metrics_unavailable',
        'Post has not been published to an external platform yet.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const accessToken = this.crypto.decrypt(post.socialAccount.encryptedAccessToken);
    const adapter = this.adapterResolver.getAdapter(post.socialAccount.platform as SocialPlatform);

    const metrics = await adapter.getMetrics({
      account: {
        platform: post.socialAccount.platform as SocialPlatform,
        platformAccountId: post.socialAccount.platformAccountId,
        accessToken,
      },
      externalPostId: post.externalPostId,
    });

    const updated = await this.prisma.scheduledPost.update({
      where: { id: postId },
      data: {
        metrics: metrics as Prisma.InputJsonValue,
      },
      include: { socialAccount: true },
    });

    return {
      synced: true,
      post: this.toSummary(updated),
      metrics: (metrics as Record<string, unknown>) ?? {},
    };
  }

  /**
   * Updates a scheduled or draft post.
   */
  async updatePost(
    postId: string,
    input: UpdateScheduledPostRequest | Valid<typeof UpdateScheduledPostBody>,
  ): Promise<ScheduledPostSummary> {
    const existing = await this.prisma.scheduledPost.findUnique({
      where: { id: postId },
      include: { socialAccount: true },
    });

    if (!existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.postNotFound,
        'Scheduled post not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing.status === 'PUBLISHED') {
      throw new ApiException(
        'post_already_published',
        'Cannot edit a post that has already been published.',
        HttpStatus.CONFLICT,
      );
    }

    /**
     * The server decides what a legal reschedule is, not the calendar.
     *
     * Three clients now move a post — the drag, the per-post "Reschedule…" menu, and the
     * keyboard path — and they all come through here. If the rule about what time is
     * acceptable lived in any of them, the three would drift and the drag would permit what
     * the keyboard refused. The UI renders this refusal rather than pre-empting it.
     */
    let scheduledAt: Date | undefined;
    if (input.scheduledAt !== undefined) {
      scheduledAt = new Date(input.scheduledAt);
      if (isNaN(scheduledAt.getTime())) {
        throw new ApiException(
          'invalid_scheduled_at',
          'Invalid scheduled timestamp.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (scheduledAt.getTime() <= Date.now()) {
        throw new ApiException(
          'invalid_scheduled_at',
          'A post cannot be scheduled in the past.',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    /**
     * Moving a post to another channel re-checks the channel.
     *
     * `schedulePost` verifies the account belongs to the brand; this path did not, so a post
     * could be updated onto an account the caller's brand does not own — the same
     * wrong-client-publish hazard the composer's confirmation exists to prevent, reached by a
     * different verb. `findFirst` on the scoped client covers the company; `brandId` covers
     * the brand.
     */
    if (input.socialAccountId !== undefined && input.socialAccountId !== existing.socialAccountId) {
      const target = await this.prisma.socialAccount.findFirst({
        where: { id: input.socialAccountId, brandId: existing.brandId },
      });
      if (!target) {
        throw new ApiException(
          MARKETING_ERROR_CODES.socialAccountNotFound,
          'Social account not found under the selected brand.',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const updated = await this.prisma.scheduledPost.update({
      where: { id: postId },
      data: {
        ...defined('content', input.content),
        ...(input.mediaUrls !== undefined
          ? { mediaUrls: input.mediaUrls as Prisma.InputJsonValue }
          : {}),
        ...(input.platformConfig !== undefined
          ? { platformConfig: input.platformConfig as Prisma.InputJsonValue }
          : {}),
        ...defined('scheduledAt', scheduledAt),
        ...defined('status', input.status),
        ...defined('socialAccountId', input.socialAccountId),
      },
      include: { socialAccount: true },
    });

    return this.toSummary(updated);
  }

  /**
   * Cancels a scheduled post.
   */
  async cancelPost(postId: string): Promise<ScheduledPostSummary> {
    const existing = await this.prisma.scheduledPost.findUnique({
      where: { id: postId },
      include: { socialAccount: true },
    });

    if (!existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.postNotFound,
        'Scheduled post not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing.status === 'PUBLISHED') {
      throw new ApiException(
        'post_already_published',
        'Cannot cancel a post that has already been published.',
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.scheduledPost.update({
      where: { id: postId },
      data: { status: 'CANCELLED' },
      include: { socialAccount: true },
    });

    return this.toSummary(updated);
  }

  /**
   * Retrieves a single scheduled post by ID.
   */
  async getPost(postId: string): Promise<ScheduledPostSummary> {
    const post = await this.prisma.scheduledPost.findUnique({
      where: { id: postId },
      include: { socialAccount: true },
    });

    if (!post) {
      throw new ApiException(
        MARKETING_ERROR_CODES.postNotFound,
        'Scheduled post not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    return this.toSummary(post);
  }

  /**
   * Lists scheduled posts with filtering and paging.
   */
  async listPosts(query: Record<string, unknown>): Promise<ScheduledPostListResponse> {
    const slice = listQuery(query, POST_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.scheduledPost.findMany({
        ...slice.findMany<Prisma.ScheduledPostFindManyArgs>(),
        include: { socialAccount: true },
      }),
      this.prisma.scheduledPost.count(slice.count<Prisma.ScheduledPostCountArgs>()),
    ]);

    return slice.respond(rows.map((row) => this.toSummary(row)), total);
  }

  private toSummary(row: {
    id: string;
    brandId: string;
    socialAccountId: string;
    campaignId: string | null;
    autolistItemId: string | null;
    content: string;
    mediaUrls: Prisma.JsonValue | null;
    platformConfig: Prisma.JsonValue | null;
    scheduledAt: Date;
    publishedAt: Date | null;
    status: string;
    failureReason: string | null;
    externalPostId: string | null;
    metrics: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
    socialAccount?: {
      id: string;
      platform: string;
      accountName: string;
    };
  }): ScheduledPostSummary {
    return {
      id: row.id,
      brandId: row.brandId,
      socialAccountId: row.socialAccountId,
      socialAccount: row.socialAccount
        ? {
            id: row.socialAccount.id,
            platform: row.socialAccount.platform as SocialPlatform,
            accountName: row.socialAccount.accountName,
          }
        : undefined,
      campaignId: row.campaignId,
      autolistItemId: row.autolistItemId,
      content: row.content,
      mediaUrls: Array.isArray(row.mediaUrls) ? (row.mediaUrls as string[]) : [],
      platformConfig: (row.platformConfig as Record<string, unknown>) ?? null,
      scheduledAt: row.scheduledAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
      status: row.status as ScheduledPostStatus,
      failureReason: row.failureReason,
      externalPostId: row.externalPostId,
      metrics: (row.metrics as Record<string, unknown>) ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Refuses a publish that would breach the platform's own quota.
   *
   * There used to be a guard above this line — `if (typeof this.prisma.scheduledPost?.count !==
   * 'function') return;` — added so a test could inject a mock without a `count`. It also
   * disabled the limit in production for any shape of client that happened not to have one. A
   * production limit that a mock can switch off is not a limit; the tests that relied on it
   * carry a real stub instead.
   */
  private async enforcePublishingRateLimit(
    socialAccountId: string,
    platform: SocialPlatform,
  ): Promise<void> {
    const window = publishingWindowFor(platform);
    if (!window) return;

    const spent = await countAgainstQuota(
      this.prisma.scheduledPost,
      socialAccountId,
      window.windowSeconds,
    );

    if (spent >= window.cap) {
      throw new ApiException(
        MARKETING_ERROR_CODES.rateLimitExceeded,
        window.refusal,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

/**
 * The states a post may be claimed from.
 *
 * `PUBLISHING` is not among them: a post already claimed belongs to whoever claimed it, and
 * including it here would reinstate exactly the double publish the claim exists to prevent.
 */
const PUBLISHABLE_STATES: ScheduledPostStatus[] = ['DRAFT', 'SCHEDULED', 'FAILED'];
