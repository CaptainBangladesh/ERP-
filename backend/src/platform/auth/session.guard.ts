import { CanActivate, ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_HEADER, AUTH_SCHEME } from '@erp/shared';
import { IS_PUBLIC } from './public.decorator';
import { unauthenticated } from './unauthenticated';
import { SessionAuthority } from './session-authority';
import { SESSION_REQUEST_KEY } from './session-context';

/**
 * Requires a valid session on every endpoint that has not explicitly opted out.
 *
 * Registered globally, so a new controller in a new module is protected by existing rather
 * than by remembering. The alternative — a guard applied per controller — makes an
 * unguarded endpoint the result of an omission, and at forty modules an omission is a
 * certainty rather than a risk.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly authority?: SessionAuthority,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (!this.authority) {
      // No module claimed authentication. Refusing is the only safe reading: the
      // application cannot tell who anyone is, so it cannot let anyone in.
      throw unauthenticated();
    }

    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const token = bearerToken(request);
    if (!token) throw unauthenticated();

    request[SESSION_REQUEST_KEY] = await this.authority.authenticate(token);
    return true;
  }
}

/**
 * Reads `Authorization: Bearer <token>`, and nothing else about it.
 *
 * The scheme is transport, so the platform can find a token without knowing what issued it
 * or what it means — that is `SessionAuthority`'s job.
 */
function bearerToken(request: Record<string, unknown>): string | undefined {
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const header = headers?.[AUTH_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;

  const [scheme, token] = value.split(' ');
  if (scheme?.toLowerCase() !== AUTH_SCHEME.toLowerCase()) return undefined;

  return token?.trim() || undefined;
}
