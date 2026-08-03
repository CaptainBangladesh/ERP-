import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, type AuthenticatedSession } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { InjectPrisma, Tenancy, type ScopedPrisma } from '../../platform/tenancy';
import { SessionAuthority, unauthenticated, type RequestSession } from '../../platform/auth';
import type { Valid } from '../../platform/validation';
import { emailAlreadyRegistered, invalidCredentials } from './errors';
import { hashPassword, verifyPassword } from './passwords';
import { SessionIssuer } from './session-issuer';
import { describe, permissionsOf, WITH_ROLES, type TokenPayload } from './session-shape';
import type { SignInBody, SignUpBody } from './schemas';

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
   * Creates a company and its first user together.
   *
   * One step rather than two because there is no state worth having between them: a company
   * with nobody in it cannot be signed into, and a user with no company has nowhere to be.
   * The two rows are written in one transaction for the same reason.
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

    const passwordHash = await hashPassword(input.password);

    const { company, user } = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.company.create({ data: { name: input.companyName } });

        const owner = await tx.user.create({
          data: {
            companyId: created.id,
            name: input.name,
            email: input.email,
            passwordHash,
          },
        });

        // Ownership is recorded as the act of creation, not granted as a role afterwards.
        // Written in the same transaction, so no committed company is ever ownerless.
        const company = await tx.company.update({
          where: { id: created.id },
          data: { ownerUserId: owner.id },
        });

        return { company, user: owner };
      })
      .catch((cause: unknown) => {
        // The check above closes the ordinary case; the unique constraint closes the race
        // between two people submitting the same address at the same moment.
        if (
          cause instanceof Prisma.PrismaClientKnownRequestError &&
          cause.code === 'P2002'
        ) {
          throw emailAlreadyRegistered();
        }
        throw cause;
      });

    // The owner's permissions are 'all' unconditionally — see `describe` — so there is
    // nothing to gain from loading roles for someone who holds every grant regardless of one.
    return this.sessions.issue(user, company, 'all');
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
