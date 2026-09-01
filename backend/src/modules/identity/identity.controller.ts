import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Redirect,
  Req,
} from '@nestjs/common';
import {
  AUTH_ROUTE,
  AUTH_SCREEN_PATHS,
  ERROR_CODES,
  GOOGLE_AUTH_RETURN_PARAMS,
  IDENTITY_ERROR_CODES,
  type AuthenticatedSession,
  type GoogleAuthMode,
  type InvitationDetails,
  type Session,
  type SignUpIntent,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { CurrentSession, Public, type RequestSession } from '../../platform/auth';
import { NoPermissionRequired } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { encodeGoogleAuthState, frontendOrigin, googleRedirectUri } from './google-auth-state';
import { IdentityService } from './identity.service';
import { RecoveryService } from './recovery.service';
import {
  AcceptInvitationBody,
  ForgotPasswordBody,
  GoogleSignInBody,
  ResetPasswordBody,
  SignInBody,
  SignUpBody,
} from './schemas';

/**
 * Everything a caller can do about who they are before, during, and to end a session.
 *
 * Only the handful that a caller with no session must reach are `@Public()`. Everything else
 * in the system — here and in every module still to come — is guarded by default, so an
 * unprotected endpoint is something somebody wrote on purpose rather than something they
 * forgot. `session()` and `signOut()` need a session and nothing more specific, which is what
 * `@NoPermissionRequired()` is for.
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
  constructor(
    private readonly identity: IdentityService,
    private readonly recovery: RecoveryService,
  ) {}

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
   * A Google identity that has already been established, exchanged for a session.
   *
   * Kept as an ordinary endpoint beside the redirect flow because it is what the tests and
   * any non-browser client use. `mode` is what makes it safe to leave public: without it the
   * request is read as a sign-in, and a sign-in never creates anything.
   */
  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleSignIn(
    @Body(validated(GoogleSignInBody)) body: Valid<typeof GoogleSignInBody>,
  ): Promise<AuthenticatedSession> {
    return this.identity.googleSignIn(body);
  }

  /**
   * The front half of the redirect flow: a full navigation the browser makes, answered with a
   * redirect to Google's consent screen.
   *
   * The client id and the registered redirect URI are read here rather than in the frontend,
   * so they live in one place — this server's environment. A bundle that carried them would
   * have to be rebuilt to change a deployment, and would drift from what the callback below
   * sends to Google when the code comes back.
   *
   * What the user had chosen before they left — sign in or sign up, which of the two options,
   * and the company name they typed — is packed into `state`, because a round trip through
   * accounts.google.com is a page load and nothing in the tab survives it. Google hands
   * `state` back untouched with the code.
   */
  @Public()
  @Get('google/login')
  @Redirect()
  async googleOAuthLogin(
    @Query() query: Record<string, unknown>,
    @Req() request: { headers?: Record<string, unknown> },
  ): Promise<{ url: string; statusCode: number }> {
    const mode = text(query.mode) as GoogleAuthMode | undefined;
    const intent = text(query.intent) as SignUpIntent | undefined;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      const returnTo = frontendOrigin(request.headers?.referer);
      const targetScreen = mode === 'signup' ? AUTH_SCREEN_PATHS.signUp : AUTH_SCREEN_PATHS.signIn;
      const failureUrl = new URL(targetScreen, returnTo);
      failureUrl.searchParams.set(
        GOOGLE_AUTH_RETURN_PARAMS.error,
        ERROR_CODES.moduleUnavailable,
      );
      if (mode === 'signup') {
        failureUrl.searchParams.set(
          GOOGLE_AUTH_RETURN_PARAMS.intent,
          intent === 'account' ? 'account' : 'company',
        );
        const companyName = text(query.companyName);
        if (companyName) {
          failureUrl.searchParams.set(GOOGLE_AUTH_RETURN_PARAMS.companyName, companyName);
        }
      }
      return { url: failureUrl.toString(), statusCode: HttpStatus.FOUND };
    }

    const googleUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    googleUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: googleRedirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      // Always ask which account, rather than silently reusing whichever one the browser
      // happens to be signed into. Somebody adding a second account here is the ordinary
      // case, not the exception.
      prompt: 'select_account',
      state: encodeGoogleAuthState({
        mode: mode === 'signup' ? 'signup' : 'signin',
        intent: intent === 'account' ? 'account' : 'company',
        companyName: text(query.companyName) ?? '',
        name: text(query.name) ?? '',
        returnTo: frontendOrigin(request.headers?.referer),
      }),
    }).toString();

    return { url: googleUrl.toString(), statusCode: HttpStatus.FOUND };
  }

  /**
   * The back half of the redirect flow: where Google returns the browser, carrying the
   * one-time code and the `state` that left with it.
   *
   * Public, and it has to be — nobody has a session yet; obtaining one is the point. What
   * makes that safe is that it grants nothing on its own: a session comes back only if the
   * code exchanges with Google using this server's client secret, and every other outcome is
   * a redirect to a form with a message on it.
   *
   * The whole decision belongs to the service, which answers with the address to send the
   * browser to. A `state` from somewhere else is not this flow's to interpret, so it goes to
   * the application's front door rather than being guessed at.
   */
  @Public()
  @Get('google/callback')
  @Redirect()
  async googleOAuthCallback(
    @Query() query: Record<string, unknown>,
    @Req() request: { headers?: Record<string, unknown> },
  ): Promise<{ url: string; statusCode: number }> {
    const destination = await this.identity.completeGoogleReturn(query);
    if (destination) {
      return { url: destination, statusCode: HttpStatus.FOUND };
    }

    const fallbackUrl = new URL(
      AUTH_SCREEN_PATHS.signIn,
      frontendOrigin(request.headers?.referer),
    );
    fallbackUrl.searchParams.set(
      GOOGLE_AUTH_RETURN_PARAMS.error,
      IDENTITY_ERROR_CODES.googleAuthFailed,
    );
    return { url: fallbackUrl.toString(), statusCode: HttpStatus.FOUND };
  }

  /**
   * Who the bearer of this token is. The frontend calls it on load to turn a stored token
   * back into a signed-in screen, which is also how it discovers the token has expired.
   */
  @Get('session')
  @NoPermissionRequired('Reading your own session needs nothing beyond being signed in.')
  session(@CurrentSession() session: RequestSession): Session {
    // The token is the credential, not part of the answer — echoing it back would put it
    // in one more place it could leak from.
    return {
      user: session.user,
      company: session.company,
      expiresAt: session.expiresAt.toISOString(),
      permissions: session.permissions === 'all' ? 'all' : [...session.permissions],
    };
  }

  /**
   * Guarded, so signing out requires being signed in. That is not ceremony: it is what
   * makes the endpoint end *your* session rather than accept an id and end somebody's.
   */
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  @NoPermissionRequired('Ending your own session needs nothing beyond being signed in.')
  async signOut(@CurrentSession() session: RequestSession): Promise<void> {
    await this.identity.signOut(session.id);
  }

  /**
   * Always answers with no content, whether or not the address has an account — see
   * `RecoveryService`. There is nothing here for a caller to learn from a status code either
   * way.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(
    @Body(validated(ForgotPasswordBody)) body: Valid<typeof ForgotPasswordBody>,
  ): Promise<void> {
    await this.recovery.forgotPassword(body);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body(validated(ResetPasswordBody)) body: Valid<typeof ResetPasswordBody>,
  ): Promise<void> {
    await this.recovery.resetPassword(body);
  }

  /** Read before rendering the accept form, so an expired link fails before anyone types. */
  @Public()
  @Get('invitations/:token')
  async invitation(@Param('token') token: string): Promise<InvitationDetails> {
    return this.recovery.invitationDetails(token);
  }

  @Public()
  @Post('invitations/:token/accept')
  @HttpCode(HttpStatus.CREATED)
  async acceptInvitation(
    @Param('token') token: string,
    @Body(validated(AcceptInvitationBody)) body: Valid<typeof AcceptInvitationBody>,
  ): Promise<AuthenticatedSession> {
    return this.recovery.acceptInvitation(token, body);
  }
}

/** One query parameter, if it was given as a string at all. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
