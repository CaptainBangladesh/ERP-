import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, type Company } from '@prisma/client';
import {
  ERROR_CODES,
  IDENTITY_ERROR_CODES,
  type AuthenticatedSession,
  type GoogleAuthMode,
  type SignUpIntent,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { InjectPrisma, Tenancy, type ScopedPrisma } from '../../platform/tenancy';
import { SessionAuthority, unauthenticated, type RequestSession } from '../../platform/auth';
import type { Valid } from '../../platform/validation';
import {
  companyAlreadyExists,
  companyDoesNotExist,
  companyNameRequired,
  emailAlreadyRegistered,
  googleAccountNotRegistered,
  invalidCredentials,
} from './errors';
import {
  decodeGoogleAuthState,
  googleFailureUrl,
  googleRedirectUri,
  googleSuccessUrl,
} from './google-auth-state';
import { hashPassword, verifyPassword } from './passwords';
import { SessionIssuer } from './session-issuer';
import { describe, permissionsOf, WITH_ROLES, type TokenPayload } from './session-shape';
import type { SignInBody, SignUpBody } from './schemas';

/**
 * What a Google round trip hands back, once the code has been exchanged and the profile read.
 *
 * The same shape whether the browser came from the sign-in screen or the sign-up one — `mode`
 * is what tells them apart, and it is the caller's word rather than something inferred from
 * whether the address turns out to be known. See `GOOGLE_AUTH_MODES`.
 */
export interface GoogleAuthentication {
  email: string;
  name?: string;
  companyName?: string;
  mode?: GoogleAuthMode;
  intent?: SignUpIntent;
}

/**
 * The way into an empty system, and the way back out of it.
 *
 * Nothing here reads a seeded row, because there are none. The first company in the
 * database is the one a user typed into the sign-up form, and the fact that they typed it
 * is what makes them its owner.
 *
 * Identity is the one module that works outside company scope, and it is not an exemption
 * it asked for: it is the module that *establishes* the tenant, so it necessarily runs
 * before there is one. Sign-up creates the company. Sign-in has to find a user by email
 * across every company, because until it has found them there is nothing to be scoped to.
 * Every such place says so, in `withoutCompanyScope`, with the reason written out — see
 * ADR 0003. No other module has any business doing this.
 */
@Injectable()
export class IdentityService implements SessionAuthority {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly jwt: JwtService,
    private readonly sessions: SessionIssuer,
  ) {}

  /**
   * Signing up, in both of the senses the form offers: opening a company, or joining one.
   *
   * Opening creates the company and its first user together — one step rather than two,
   * because there is no state worth having between them: a company with nobody in it cannot
   * be signed into, and a user with no company has nowhere to be. The two rows are written
   * in one transaction for the same reason.
   *
   * Joining writes only the user, into a company somebody else opened. Which of the two this
   * is comes from `intent`, and the company's name is required either way — see
   * `placeInCompany` for what each option asks of it.
   */
  async signUp(input: Valid<typeof SignUpBody>): Promise<AuthenticatedSession> {
    return this.tenancy.withoutCompanyScope(
      'Sign-up creates the company. There is no company to be scoped to until it exists, ' +
        'and the email uniqueness check is deliberately across all of them.',
      () => this.createCompanyAndOwner(input),
    );
  }

  private async createCompanyAndOwner(
    input: Valid<typeof SignUpBody>,
  ): Promise<AuthenticatedSession> {
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) {
      throw emailAlreadyRegistered();
    }

    // Before the password is hashed, which is the expensive part: there is no sense paying
    // for scrypt on a submission the company rule is about to refuse.
    const placement = await this.placeInCompany(input.intent, input.companyName);
    const passwordHash = await hashPassword(input.password);

    return this.admit(placement, { name: input.name, email: input.email, passwordHash });
  }

  /**
   * Which company somebody signing up ends up in — the one question both sign-up paths ask,
   * and the only place the two options on the form mean anything.
   *
   * The company's name is required either way. What differs is what is asked of it:
   *
   *   `company` — opening one — the name must be *free*. Refusing a taken one is the whole
   *   protection against two workspaces nobody could tell apart afterwards.
   *
   *   `account` — working for one — the name must *already exist*. There is nothing to open,
   *   and inventing a company for somebody who said they work at one would strand them alone
   *   in an empty copy of their employer.
   *
   * Matched case-insensitively, because "Northwind Trading" and "northwind trading" are one
   * company to everybody except a `=` — and that name is what the second option matches on.
   *
   * Deliberately *not* a check on how many companies exist. The first user is not a special
   * case here: they open a company like everybody else, and it succeeds because the name is
   * free rather than because the table is empty.
   */
  private async placeInCompany(
    intent: SignUpIntent | undefined,
    companyName: string | undefined,
  ): Promise<Placement> {
    const name = companyName?.trim() ?? '';
    if (!name) throw companyNameRequired();

    const existing = await this.prisma.company.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });

    // Absent means `company`, the option that joins nothing: a request that never said what
    // it wanted must not be read as permission to walk into somebody else's workspace.
    if ((intent ?? 'company') === 'account') {
      if (!existing) throw companyDoesNotExist();
      return { join: existing };
    }

    if (existing) throw companyAlreadyExists();
    return { open: name };
  }

  /**
   * Writes the user the placement calls for, and hands back the session they are now in.
   *
   * Joining is one row; opening is a company, its first user, and the ownership between them
   * in one transaction. Both sign-up paths and both Google intents end here rather than each
   * spelling out how a company gets an owner.
   */
  private async admit(
    placement: Placement,
    person: { name: string; email: string; passwordHash: string },
  ): Promise<AuthenticatedSession> {
    if ('join' in placement) {
      const user = await this.prisma.user
        .create({ data: { companyId: placement.join.id, ...person } })
        .catch(rethrowDuplicateEmail);

      // No permissions yet: joining grants none until somebody inside the company gives them
      // a role. That is the honest state of a colleague who has just walked in, and it is why
      // the second option cannot be used to help yourself to anybody's data.
      return this.sessions.issue(user, placement.join, []);
    }

    const { company, user } = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.company.create({ data: { name: placement.open } });

        const owner = await tx.user.create({ data: { companyId: created.id, ...person } });

        // Ownership is recorded as the act of creation, not granted as a role afterwards.
        // Written in the same transaction, so no committed company is ever ownerless.
        const company = await tx.company.update({
          where: { id: created.id },
          data: { ownerUserId: owner.id },
        });

        return { company, user: owner };
      })
      .catch(rethrowDuplicateEmail);

    // The owner's permissions are 'all' unconditionally — see `describe` — so there is
    // nothing to gain from loading roles for someone who holds every grant regardless of one.
    return this.sessions.issue(user, company, 'all');
  }

  /**
   * Google's answer to "who is this", turned into a session.
   *
   * Google establishes *identity* by the time this runs. What it does not establish is
   * whether that person has an account here — and the two screens want opposite things from
   * an address it has never seen: sign-in refuses it, sign-up exists to create it. So the
   * mode is carried through the whole round trip rather than inferred. Inferring it is what
   * would let "Continue with Google" quietly manufacture a company for somebody who signed
   * in with the wrong Google account, and let a Google sign-up silently adopt an account
   * that already belongs to somebody.
   *
   * Past that point a Google sign-up is an ordinary sign-up: the same two options and the
   * same company rules as the password form, because it is the same decision.
   */
  async googleSignIn(input: GoogleAuthentication): Promise<AuthenticatedSession> {
    const email = input.email.trim().toLowerCase();
    const name = input.name?.trim() || email.split('@')[0]!;
    const mode = input.mode ?? 'signin';

    return this.tenancy.withoutCompanyScope(
      'Google hands back an email and nothing else. Which company it belongs to — or ' +
        'whether it belongs to one yet — is the whole question, so it cannot be scoped to ' +
        'one first.',
      async () => {
        const existing = await this.prisma.user.findUnique({
          where: { email },
          include: { company: true, ...WITH_ROLES },
        });

        if (existing) {
          // Signing up with an address that already has an account is not a second account:
          // it is somebody who meant to sign in, and saying so sends them one click away
          // instead of into a duplicate.
          if (mode === 'signup') throw emailAlreadyRegistered();

          const isOwner = existing.company.ownerUserId === existing.id;
          return this.sessions.issue(
            existing,
            existing.company,
            isOwner ? 'all' : permissionsOf(existing),
          );
        }

        if (mode !== 'signup') throw googleAccountNotRegistered();

        const placement = await this.placeInCompany(input.intent, input.companyName);

        // A password nobody holds, including the person it belongs to. The column is not
        // nullable, and sign-in must not become reachable for an account that was never
        // given one — so the value is random rather than derived from anything. A hash of
        // the moment of signing up would be a password an attacker could search.
        const passwordHash = await hashPassword(randomBytes(32).toString('hex'));

        return this.admit(placement, { name, email, passwordHash });
      },
    );
  }

  /**
   * The back half of the redirect flow: Google's one-time code, exchanged for the profile
   * behind it.
   *
   * Nothing here falls back to a session. An exchange that fails means this request cannot
   * say who is calling, and the only honest outcome is a refusal — which the callback turns
   * into a message on the screen the user started from. Signing somebody in anyway, as any
   * fallback address, would mean a failed Google login handing out a real session.
   */
  async handleGoogleOAuthCode(
    code: string,
    redirectUri: string,
    context: Omit<GoogleAuthentication, 'email'> = {},
  ): Promise<AuthenticatedSession> {
    const profile = await this.exchangeGoogleCode(code, redirectUri);

    return this.googleSignIn({
      email: profile.email,
      name: profile.name || context.name,
      companyName: context.companyName,
      mode: context.mode,
      intent: context.intent,
    });
  }

  /**
   * A return from Google, all the way to the address the browser should be sent to next.
   *
   * The whole round trip resolves here rather than in the controller that owns the callback
   * route, because every part of it is identity's: what the `state` means, whether the code
   * exchanges, which refusal a failure is, and which screen says so. A caller needs to know
   * only whether this return was a sign-in at all — `null` says it was not, and that the
   * caller's own flow should have it.
   */
  async completeGoogleReturn(query: Record<string, unknown>): Promise<string | null> {
    const state = decodeGoogleAuthState(query.state);
    if (!state) return null;

    const code = typeof query.code === 'string' ? query.code : '';

    // Google reports a consent screen the user backed out of as `error` and no code. There
    // is nothing to exchange; they are simply back where they started.
    if (!code) return googleFailureUrl(state, undefined);

    try {
      const session = await this.handleGoogleOAuthCode(code, googleRedirectUri(), state);
      return googleSuccessUrl(state, session.token);
    } catch (cause) {
      return googleFailureUrl(state, cause);
    }
  }

  private async exchangeGoogleCode(
    code: string,
    redirectUri: string,
  ): Promise<{ email: string; name?: string }> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    // Credentials belong in the environment and nowhere else. A hard-coded fallback would be
    // a client secret in the repository, and a deployment that quietly authenticated against
    // somebody else's Google project instead of failing on the missing configuration.
    if (!clientId || !clientSecret) throw googleUnconfigured();

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    }).catch(() => undefined);

    if (!tokenResponse?.ok) throw googleExchangeFailed();

    const tokens = (await tokenResponse.json()) as { id_token?: string; access_token?: string };

    // The id token comes from Google over this exchange and carries the address already, so
    // the ordinary case costs no second call. `userinfo` is the fallback for a response that
    // omits it.
    const claims = tokens.id_token ? readIdTokenClaims(tokens.id_token) : null;
    if (claims?.email) return { email: claims.email, name: claims.name };

    if (tokens.access_token) {
      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }).catch(() => undefined);

      if (profileResponse?.ok) {
        const profile = (await profileResponse.json()) as { email?: string; name?: string };
        if (profile.email) return { email: profile.email, name: profile.name };
      }
    }

    throw googleExchangeFailed();
  }

  async signIn(input: Valid<typeof SignInBody>): Promise<AuthenticatedSession> {
    const user = await this.tenancy.withoutCompanyScope(
      'Sign-in is given an email and nothing else. Finding which company the address ' +
        'belongs to is the whole job, so it cannot be scoped to one first.',
      () =>
        // Already lower-cased and trimmed by the rule that read it, which is what makes the
        // unique constraint on the column mean what it appears to mean.
        this.prisma.user.findUnique({
          where: { email: input.email },
          include: { company: true, ...WITH_ROLES },
        }),
    );

    // Hashing even when no user was found keeps a wrong address and a wrong password
    // costing the same amount of time, so the form cannot be used to discover who has an
    // account here by watching the clock.
    const stored = user?.passwordHash ?? NO_SUCH_USER_HASH;
    const correct = await verifyPassword(input.password, stored);

    if (!user || !correct) throw invalidCredentials();

    const isOwner = user.company.ownerUserId === user.id;
    return this.sessions.issue(user, user.company, isOwner ? 'all' : permissionsOf(user));
  }

  /**
   * Ends one session — the one that asked — and leaves the user's others alone. Signing out
   * of the office machine should not sign you out of the one at home.
   *
   * Revoking rather than deleting keeps the row, so "this token was withdrawn" stays
   * distinguishable from "this token was never issued".
   */
  async signOut(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Turns a token into a caller, or refuses.
   *
   * The token is proof of who issued it; the session row is the say on whether it still
   * counts. Both are required, which is what makes signing out take effect immediately
   * instead of whenever the token happens to run out.
   */
  async authenticate(token: string): Promise<RequestSession> {
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw unauthenticated();
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { company: true, ...WITH_ROLES } } },
    });

    if (!session || session.revokedAt) throw unauthenticated();

    if (session.expiresAt.getTime() <= Date.now()) {
      // Told apart from `unauthenticated` because the two mean different things to a
      // person: one was signed in and was timed out, the other never signed in.
      throw new ApiException(
        ERROR_CODES.sessionExpired,
        'Your session has expired. Please sign in again.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Read fresh on every request rather than carried in the token, which is what makes a
    // role change — or a tier change — take effect on the caller's very next request.
    const isOwner = session.user.company.ownerUserId === session.user.id;

    return {
      id: session.id,
      expiresAt: session.expiresAt,
      ...describe(
        session.user,
        session.user.company,
        isOwner ? 'all' : permissionsOf(session.user),
      ),
    };
  }
}

/**
 * A well-formed hash of a password nobody has, used when sign-in finds no user.
 *
 * Its only job is to make the verification step cost what a real one costs.
 */
const NO_SUCH_USER_HASH = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);

/**
 * Where somebody signing up ends up: a company that already exists, or a name free to open
 * one under. `placeInCompany` decides which; `admit` writes it.
 */
type Placement = { join: Company } | { open: string };

/**
 * The unique constraint on the email column, as the same refusal the pre-flight check raises.
 *
 * Both sign-up paths look the address up before writing. This closes the gap between that
 * read and the insert — two people submitting the same address at the same moment — so the
 * loser of the race is told the address is taken rather than shown a 500.
 */
function rethrowDuplicateEmail(cause: unknown): never {
  if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
    throw emailAlreadyRegistered();
  }
  throw cause;
}

/**
 * The claims inside a Google id token, read without verifying the signature.
 *
 * Safe only because of where it is called: the token was just fetched over TLS from Google's
 * own token endpoint, in exchange for a client secret, rather than accepted from a browser.
 * A token that arrived any other way would have to be verified against Google's keys before
 * a single claim in it meant anything.
 */
function readIdTokenClaims(token: string): { email?: string; name?: string } | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

/** Google is not configured on this deployment — an operator's problem, not the user's. */
function googleUnconfigured(): ApiException {
  return new ApiException(
    ERROR_CODES.moduleUnavailable,
    'Signing in with Google is not configured on this server.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

/**
 * Google would not tell us who this is. Nobody is signed in as a result.
 *
 * Its own code rather than `unauthenticated`, which every module raises for a request that
 * arrived without a session: this is a round trip that did not complete, and it is the one
 * outcome both screens render as "try again" rather than as anything about the user.
 */
function googleExchangeFailed(): ApiException {
  return new ApiException(
    IDENTITY_ERROR_CODES.googleAuthFailed,
    'Google did not confirm who you are. Please try again.',
    HttpStatus.UNAUTHORIZED,
  );
}
