import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import type { Company, User } from '@prisma/client';
import {
  ERROR_CODES,
  IDENTITY_ERROR_CODES,
  type AuthenticatedSession,
  type Session,
  type SignInRequest,
  type SignUpRequest,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { FieldException } from '../../http/validation-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionAuthority, unauthenticated, type RequestSession } from '../../platform/auth';
import { hashPassword, verifyPassword } from './passwords';
import { sessionExpiry } from './session.config';
import { normaliseEmail, validateSignIn, validateSignUp } from './validation';

/** What a token carries. Everything else about the caller is read from the database. */
interface TokenPayload {
  sub: string;
  sid: string;
  cid: string;
}

/**
 * The way into an empty system, and the way back out of it.
 *
 * Nothing here reads a seeded row, because there are none. The first company in the
 * database is the one a user typed into the sign-up form, and the fact that they typed it
 * is what makes them its owner.
 */
@Injectable()
export class IdentityService implements SessionAuthority {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Creates a company and its first user together.
   *
   * One step rather than two because there is no state worth having between them: a company
   * with nobody in it cannot be signed into, and a user with no company has nowhere to be.
   * The two rows are written in one transaction for the same reason.
   */
  async signUp(body: Partial<SignUpRequest> | undefined): Promise<AuthenticatedSession> {
    const input = validateSignUp(body);

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

    return this.startSession(describe(user, company));
  }

  async signIn(body: Partial<SignInRequest> | undefined): Promise<AuthenticatedSession> {
    const input = validateSignIn(body);

    const user = await this.prisma.user.findUnique({
      where: { email: normaliseEmail(input.email) },
      include: { company: true },
    });

    // Hashing even when no user was found keeps a wrong address and a wrong password
    // costing the same amount of time, so the form cannot be used to discover who has an
    // account here by watching the clock.
    const stored = user?.passwordHash ?? NO_SUCH_USER_HASH;
    const correct = await verifyPassword(input.password, stored);

    if (!user || !correct) throw invalidCredentials();

    return this.startSession(describe(user, user.company));
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
      include: { user: { include: { company: true } } },
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

    return {
      id: session.id,
      expiresAt: session.expiresAt,
      ...describe(session.user, session.user.company),
    };
  }

  private async startSession(caller: Omit<Session, 'expiresAt'>): Promise<AuthenticatedSession> {
    const expiresAt = sessionExpiry();

    const row = await this.prisma.session.create({
      data: { userId: caller.user.id, expiresAt },
    });

    const payload: TokenPayload = {
      sub: caller.user.id,
      sid: row.id,
      cid: caller.company.id,
    };

    return {
      ...caller,
      expiresAt: expiresAt.toISOString(),
      // The token expires with the row it names, so a token that outlived its session
      // cannot exist to be reasoned about.
      token: await this.jwt.signAsync(payload, {
        expiresIn: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      }),
    };
  }
}

/**
 * The one description of a caller, so sign-up, sign-in, and authentication cannot disagree
 * about what a user is — particularly about `isOwner`, which is derived rather than stored
 * and would be easy to compute three slightly different ways.
 */
function describe(user: User, company: Company): Omit<Session, 'expiresAt'> {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isOwner: company.ownerUserId === user.id,
    },
    company: { id: company.id, name: company.name },
  };
}

/**
 * A well-formed hash of a password nobody has, used when sign-in finds no user.
 *
 * Its only job is to make the verification step cost what a real one costs.
 */
const NO_SUCH_USER_HASH = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);

/**
 * Carries a field as well as a code. The code is what a client branches on; the field is
 * what puts the message beside the email input rather than at the top of the form.
 *
 * Sign-up is the one place admitting an address is taken is right: the user is trying to
 * create that account, telling them nothing leaves them stuck, and a form that lets you
 * discover the answer by trying cannot keep the secret anyway.
 */
function emailAlreadyRegistered(): FieldException {
  return new FieldException(
    IDENTITY_ERROR_CODES.emailAlreadyRegistered,
    'That email address is already registered.',
    HttpStatus.CONFLICT,
    { email: 'That email address is already registered. Sign in instead.' },
  );
}

function invalidCredentials(): ApiException {
  return new ApiException(
    IDENTITY_ERROR_CODES.invalidCredentials,
    'That email address and password do not match an account.',
    HttpStatus.UNAUTHORIZED,
  );
}
