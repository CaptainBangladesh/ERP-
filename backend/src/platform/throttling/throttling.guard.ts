import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { ApiException } from '../../http/api-exception';
import { THROTTLE_BY, THROTTLED } from './throttle.decorator';

/** The one code a throttled caller ever sees. Mirrored in the shared contract for clients. */
const TOO_MANY_REQUESTS = 'too_many_requests';

/**
 * Enforces the limits handlers declare, and nothing else.
 *
 * Bound globally so a handler only has to say `@Throttle(...)` to be covered, but skipping
 * everything that has not said it: the authenticated internal surface is forty modules of
 * ordinary CRUD, and a blanket limit there would be a number nobody chose sitting between
 * users and their own data. `@SkipThrottle()` still works for turning a declared limit off.
 */
@Injectable()
export class ThrottlingGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (await super.shouldSkip(context)) return true;

    const declared = this.reflector.getAllAndOverride<boolean>(THROTTLED, [
      context.getHandler(),
      context.getClass(),
    ]);

    return declared !== true;
  }

  /**
   * The bucket: who is calling, which route, and — where the handler named one — which
   * resource. Without the last part one abusive caller on one form would consume the budget
   * every other form on the deployment shares.
   */
  protected override generateKey(context: ExecutionContext, suffix: string, name: string): string {
    const by = this.reflector.getAllAndOverride<string | null>(THROTTLE_BY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<{
      route?: { path?: string };
      params?: Record<string, string>;
      body?: Record<string, unknown>;
    }>();

    const scope = by
      ? String(request.params?.[by] ?? request.body?.[by] ?? 'unscoped')
      : (request.route?.path ?? context.getHandler().name);

    return `${name}:${scope}:${suffix}`;
  }

  /**
   * A refusal says 429 and when to come back, and nothing else.
   *
   * No detail in the body: the number of requests already made, the window, and the bucket the
   * caller landed in are all things an abusive caller would use to tune, and a legitimate one
   * has `Retry-After` to act on.
   */
  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const seconds = Math.max(1, Math.ceil((detail.timeToBlockExpire || detail.timeToExpire || 1)));
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): unknown }>()
      .setHeader('Retry-After', String(seconds));

    throw new ApiException(
      TOO_MANY_REQUESTS,
      'Too many requests. Try again shortly.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
