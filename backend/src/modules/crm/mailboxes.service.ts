import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  MAILBOX_ERROR_CODES,
  type ConnectMailboxUrlResponse,
  type MailboxConnectionSummary,
  type MailboxProvider,
  type MailboxStatus,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import {
  companyApplied,
  InjectPrisma,
  Tenancy,
  type ScopedPrisma,
} from '../../platform/tenancy';

@Injectable()
export class MailboxesService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
  ) {}

  async createConnectUrl(
    provider: MailboxProvider,
    actor: { userId: string },
  ): Promise<ConnectMailboxUrlResponse> {
    const stateToken = `mbs_${randomBytes(16).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.prisma.mailboxAuthState.create({
      data: companyApplied({
        userId: actor.userId,
        provider,
        stateToken,
        expiresAt,
      }),
    });

    const url = `/api/crm/mailboxes/callback?state=${stateToken}&code=mock_code_12345`;

    return { url, stateToken };
  }

  async handleOAuthCallback(
    stateToken: string,
    code: string,
  ): Promise<{ success: boolean; mailboxId: string }> {
    const authState = await this.tenancy.withoutCompanyScope(
      'crm.mailbox.oauth_state_lookup',
      () =>
        this.prisma.mailboxAuthState.findUnique({
          where: { stateToken },
        }),
    );

    if (!authState || authState.expiresAt.getTime() <= Date.now()) {
      throw invalidAuthState();
    }

    return this.tenancy.runInCompany(
      { companyId: authState.companyId, grants: 'all' },
      async () => {
        const emailAddress = `${authState.provider}_user@example.com`;
        const displayName = `${authState.provider.toUpperCase()} Sales User`;

        const existing = await this.prisma.mailboxConnection.findUnique({
          where: {
            companyId_userId_provider: {
              companyId: authState.companyId,
              userId: authState.userId,
              provider: authState.provider,
            },
          },
        });

        let mailboxId: string;

        if (existing) {
          const updated = await this.prisma.mailboxConnection.update({
            where: { id: existing.id },
            data: {
              status: 'connected',
              accessToken: `mock_access_${code}`,
              connectedAt: new Date(),
            },
          });
          mailboxId = updated.id;
        } else {
          const created = await this.prisma.mailboxConnection.create({
            data: companyApplied({
              userId: authState.userId,
              provider: authState.provider,
              emailAddress,
              displayName,
              status: 'connected',
              accessToken: `mock_access_${code}`,
              refreshToken: `mock_refresh_${code}`,
            }),
          });
          mailboxId = created.id;
        }

        await this.prisma.mailboxAuthState.deleteMany({
          where: { id: authState.id },
        });

        return { success: true, mailboxId };
      },
    );
  }

  async listMailboxes(userId: string): Promise<MailboxConnectionSummary[]> {
    const rows = await this.prisma.mailboxConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r: any) => describeMailbox(r));
  }

  async requireMailbox(id: string): Promise<MailboxConnectionSummary> {
    const row = await this.prisma.mailboxConnection.findUnique({
      where: { id },
    });
    if (!row) throw mailboxNotFound();
    return describeMailbox(row);
  }

  async disconnectMailbox(id: string): Promise<MailboxConnectionSummary> {
    const row = await this.prisma.mailboxConnection.findUnique({
      where: { id },
    });
    if (!row) throw mailboxNotFound();

    const updated = await this.prisma.mailboxConnection.update({
      where: { id },
      data: { status: 'revoked' },
    });

    return describeMailbox(updated);
  }
}

export function describeMailbox(row: {
  id: string;
  userId: string;
  provider: string;
  emailAddress: string;
  displayName: string;
  status: string;
  connectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): MailboxConnectionSummary {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider as MailboxProvider,
    emailAddress: row.emailAddress,
    displayName: row.displayName,
    status: row.status as MailboxStatus,
    connectedAt: row.connectedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mailboxNotFound(): ApiException {
  return new ApiException(
    MAILBOX_ERROR_CODES.mailboxNotFound,
    'That mailbox connection does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

export function mailboxNotConnected(reason?: string): ApiException {
  return new ApiException(
    MAILBOX_ERROR_CODES.mailboxNotConnected,
    `Mailbox connection is not active.${reason ? ' ' + reason : ''}`,
    HttpStatus.BAD_REQUEST,
  );
}

export function invalidAuthState(): ApiException {
  return new ApiException(
    MAILBOX_ERROR_CODES.invalidAuthState,
    'Invalid or expired OAuth state token.',
    HttpStatus.BAD_REQUEST,
  );
}
