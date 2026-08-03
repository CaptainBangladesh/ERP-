import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Company, User } from '@prisma/client';
import type { AuthenticatedSession } from '@erp/shared';
import { InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { sessionExpiry } from './session.config';
import { describe, type TokenPayload } from './session-shape';

/**
 * Starts a session for a user who already exists: sign-up's new owner, sign-in's returning
 * user, and an invitation's freshly accepted colleague all end up here, so the three cannot
 * drift into three slightly different tokens.
 */
@Injectable()
export class SessionIssuer {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly jwt: JwtService,
  ) {}

  async issue(
    user: User,
    company: Company,
    permissions: 'all' | string[],
  ): Promise<AuthenticatedSession> {
    const expiresAt = sessionExpiry();

    const row = await this.prisma.session.create({
      data: { userId: user.id, expiresAt },
    });

    const payload: TokenPayload = { sub: user.id, sid: row.id, cid: company.id };

    return {
      ...describe(user, company, permissions),
      expiresAt: expiresAt.toISOString(),
      // The token expires with the row it names, so a token that outlived its session cannot
      // exist to be reasoned about.
      token: await this.jwt.signAsync(payload, {
        expiresIn: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      }),
    };
  }
}
