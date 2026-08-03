import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RECOVERY_LINKS,
  type InvitationListResponse,
  type InvitationResponse,
  type UserListResponse,
  type UserResponse,
} from '@erp/shared';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, Tenancy, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { Mailer } from '../../platform/mail';
import { emailAlreadyRegistered, roleNotFound, userNotFound } from './errors';
import { describeRole } from './roles.service';
import { AssignRoleBody, INVITATION_LIST, InviteColleagueBody, USER_LIST } from './schemas';
import { WITH_ROLES, type UserWithRoles } from './session-shape';

/** How long an invitation works before whoever sent it has to send another. */
const INVITATION_TTL_DAYS = 7;

/**
 * Colleagues: who is in the company, which roles each of them holds, and the invitations
 * still waiting to be accepted.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly mailer: Mailer,
  ) {}

  async listUsers(query: Record<string, unknown>): Promise<UserListResponse> {
    const slice = listQuery(query, USER_LIST);

    const [users, total, company] = await Promise.all([
      this.prisma.user.findMany({
        ...slice.findMany<Prisma.UserFindManyArgs>(),
        include: { ...WITH_ROLES },
      }),
      this.prisma.user.count(slice.count<Prisma.UserCountArgs>()),
      this.prisma.company.findFirstOrThrow(),
    ]);

    return slice.respond(
      users.map((user) => describeUser(user, company.ownerUserId)),
      total,
    );
  }

  async assignRole(userId: string, input: Valid<typeof AssignRoleBody>): Promise<UserResponse> {
    await this.requireUser(userId);

    const role = await this.prisma.role.findFirst({ where: { id: input.roleId } });
    if (!role) throw roleNotFound();

    await this.prisma.userRole
      .create({
        data: companyApplied<Prisma.UserRoleUncheckedCreateInput>({
          userId,
          roleId: input.roleId,
        }),
      })
      .catch((cause: unknown) => {
        // Holding a role twice is not a different fact from holding it once.
        if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
          return undefined;
        }
        throw cause;
      });

    return this.userResponse(userId);
  }

  async removeRole(userId: string, roleId: string): Promise<UserResponse> {
    await this.requireUser(userId);
    await this.prisma.userRole.deleteMany({ where: { userId, roleId } });
    return this.userResponse(userId);
  }

  private async requireUser(userId: string): Promise<void> {
    if (!(await this.prisma.user.findFirst({ where: { id: userId } }))) throw userNotFound();
  }

  private async userResponse(userId: string): Promise<UserResponse> {
    const [user, company] = await Promise.all([
      this.prisma.user.findFirstOrThrow({ where: { id: userId }, include: { ...WITH_ROLES } }),
      this.prisma.company.findFirstOrThrow(),
    ]);
    return describeUser(user, company.ownerUserId);
  }

  async listInvitations(query: Record<string, unknown>): Promise<InvitationListResponse> {
    const slice = listQuery(query, INVITATION_LIST);
    const findArgs = slice.findMany<Prisma.InvitationFindManyArgs>();
    const countArgs = slice.count<Prisma.InvitationCountArgs>();

    const [invitations, total] = await Promise.all([
      // Accepted invitations are colleagues now — they belong in the user list, not here.
      this.prisma.invitation.findMany({ ...findArgs, where: { ...findArgs.where, acceptedAt: null } }),
      this.prisma.invitation.count({ ...countArgs, where: { ...countArgs.where, acceptedAt: null } }),
    ]);

    return slice.respond(invitations.map(describeInvitation), total);
  }

  async inviteColleague(
    invitedByUserId: string,
    input: Valid<typeof InviteColleagueBody>,
  ): Promise<InvitationResponse> {
    const alreadyRegistered = await this.tenancy.withoutCompanyScope(
      'An invited address must be unique across every company, the same check sign-up makes ' +
        'before a company exists to scope the lookup to.',
      () => this.prisma.user.findUnique({ where: { email: input.email } }),
    );
    if (alreadyRegistered) throw emailAlreadyRegistered();

    if (input.roleId) {
      const role = await this.prisma.role.findFirst({ where: { id: input.roleId } });
      if (!role) throw roleNotFound();
    }

    const invitation = await this.prisma.invitation.create({
      data: companyApplied<Prisma.InvitationUncheckedCreateInput>({
        email: input.email,
        roleId: input.roleId,
        invitedById: invitedByUserId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
      }),
    });

    await this.mailer.send({
      to: input.email,
      subject: "You're invited to join your team",
      body:
        `Accept your invitation: ${RECOVERY_LINKS.acceptInvitation(invitation.id)}\n\n` +
        `This link works once and expires in ${INVITATION_TTL_DAYS} days.`,
    });

    return describeInvitation(invitation);
  }
}

function describeUser(user: UserWithRoles, ownerUserId: string | null): UserResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isOwner: ownerUserId === user.id,
    roles: user.userRoles.map((userRole) => describeRole(userRole.role)),
  };
}

function describeInvitation(invitation: {
  id: string;
  email: string;
  roleId: string | null;
  expiresAt: Date;
  createdAt: Date;
}): InvitationResponse {
  return {
    id: invitation.id,
    email: invitation.email,
    roleId: invitation.roleId ?? undefined,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}
