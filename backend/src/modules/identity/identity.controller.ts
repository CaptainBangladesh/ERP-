import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AUTH_ROUTE, type AuthenticatedSession, type Session } from '@erp/shared';
import { CurrentSession, Public, type RequestSession } from '../../platform/auth';
import { validated, type Valid } from '../../platform/validation';
import { IdentityService } from './identity.service';
import { SignInBody, SignUpBody } from './schemas';

/**
 * The four things a caller can do about who they are.
 *
 * Only the two that a caller with no session must reach are `@Public()`. Everything else in
 * the system — here and in every module still to come — is guarded by default, so an
 * unprotected endpoint is something somebody wrote on purpose rather than something they
 * forgot.
 *
 * The path comes from the shared contract rather than being spelled out here, so the client
 * and the server cannot drift: changing it is a type error in both workspaces rather than a
 * 404 in production.
 *
 * What a body is allowed to be is declared on the parameter, in `schemas.ts`, and the service
 * below is handed values that have already passed. It never sees a `Partial<…>` and has no
 * branch for a field that might not be there.
 */
@Controller(AUTH_ROUTE)
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @Post('sign-up')
  @HttpCode(HttpStatus.CREATED)
  async signUp(
    @Body(validated(SignUpBody)) body: Valid<typeof SignUpBody>,
  ): Promise<AuthenticatedSession> {
    return this.identity.signUp(body);
  }

  @Public()
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body(validated(SignInBody)) body: Valid<typeof SignInBody>,
  ): Promise<AuthenticatedSession> {
    return this.identity.signIn(body);
  }

  /**
   * Who the bearer of this token is. The frontend calls it on load to turn a stored token
   * back into a signed-in screen, which is also how it discovers the token has expired.
   */
  @Get('session')
  session(@CurrentSession() session: RequestSession): Session {
    // The token is the credential, not part of the answer — echoing it back would put it
    // in one more place it could leak from.
    return {
      user: session.user,
      company: session.company,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  /**
   * Guarded, so signing out requires being signed in. That is not ceremony: it is what
   * makes the endpoint end *your* session rather than accept an id and end somebody's.
   */
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(@CurrentSession() session: RequestSession): Promise<void> {
    await this.identity.signOut(session.id);
  }
}
