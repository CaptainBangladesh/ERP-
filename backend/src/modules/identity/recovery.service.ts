import { Injectable } from '@nestjs/common';
import type { Invitation } from '@prisma/client';
import { RECOVERY_LINKS, type AuthenticatedSession, type InvitationDetails } from '@erp/shared';
import { InjectPrisma, Tenancy, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { Mailer } from '../../platform/mail';
import { emailAlreadyRegistered, invitationInvalid, resetTokenInvalid } from './errors';
import { hashPassword } from './passwords';
import { SessionIssuer } from './session-issuer';
import type {
  AcceptInvitationBody,
  ForgotPasswordBody,
  ResetPasswordBody,
} from './schemas';

/** How long a reset link works before it has to be asked for again. */
const RESET_TTL_HOURS = 1;

/**
 * The way back in when sign-up's password was mistyped, and the way in for anybody who did
 * not sign up at all.
 *
 * Both flows share one shape: an unguessable token — the row's own `id`, exactly as `Session`
 * already sets the precedent for — resolved by `withoutCompanyScope` because whoever is
 * holding it has no session yet, the same reasoning identity's own sign-in already applies to
 * finding a `User` by email across every company.
 */
@Injectable()
export class RecoveryService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly mailer: Mailer,
    private readonly sessions: SessionIssuer,
  ) {}

  /**
   * Always answers the same way — no content, no body, no code — whether or not the address
   * has an account. That is the criterion: the *response* cannot be used to discover who has
   * one, so the form is not a way to enumerate this system's users.
   *
   * It is deliberately not constant-*time*: an address with an account costs an insert and a
   * send, and one without costs neither. Closing that would mean doing fake work on a path
   * where the real work is a write, which buys little against an attacker who can already
   * observe whether the mail arrives, and costs a row nobody asked for on every probe. Sign-in
   * hashes a dummy password for the analogous reason precisely because there the work is a
   * *read* and the dummy is free; here it is not the same trade.
   */
  async forgotPassword(input: Valid<typeof ForgotPasswordBody>): Promise<void> {
    await this.tenancy.withoutCompanyScope(
      'Forgot-password is given an email and nothing else, and must answer identically ' +
        'whether or not it belongs to an account — there is no company to scope to either way.',
      async () => {
        const user = await this.prisma.user.findUnique({ where: { email: input.email } });
        if (!user) return;

        const reset = await this.prisma.passwordReset.create({
          data: {
            companyId: user.companyId,
            userId: user.id,
            expiresAt: new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000),
          },
        });

        await this.mailer.send({
          to: user.email,
          subject: 'Reset your password',
          body:
            `Use this link to choose a new password: ` +
            `${RECOVERY_LINKS.resetPassword(reset.id)}\n\n` +
            `This link works once and expires in ${RESET_TTL_HOURS} hour. If you did not ` +
            `ask for this, you can ignore this email.`,
        });
      },
    );
  }

  /**
   * Sets a new password from a live token, and ends every session the user held —
   * deliberately: whoever still has one of those open may not be the person who just proved
   * they know the new password.
   */
  async resetPassword(input: Valid<typeof ResetPasswordBody>): Promise<void> {
    await this.tenancy.withoutCompanyScope(
      'A reset token is resolved before its user has a session — that is the whole point of ' +
        'the link.',
      async () => {
        const reset = await this.prisma.passwordReset
          .findUnique({ where: { id: input.token } })
          .catch(() => undefined);

        if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) {
          throw resetTokenInvalid();
        }

        const passwordHash = await hashPassword(input.password);

        await this.prisma.$transaction([
          this.prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
          this.prisma.passwordReset.update({
            where: { id: reset.id },
            data: { usedAt: new Date() },
          }),
          this.prisma.session.updateMany({
            where: { userId: reset.userId, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
        ]);
      },
    );
  }

  /** What the accept screen shows before anybody has typed anything, or refuses. */
  async invitationDetails(token: string): Promise<InvitationDetails> {
    return this.tenancy.withoutCompanyScope(
      'An invitation is resolved before its recipient has any session — that is the whole ' +
        'point of the link.',
      async () => {
        const invitation = await this.liveInvitation(token);
        const company = await this.prisma.company.findUniqueOrThrow({
          where: { id: invitation.companyId },
        });
        return { companyName: company.name, email: invitation.email };
      },
    );
  }

  /**
   * Creates the account the invitation named, grants the role it offered (if any), and signs
   * the new colleague in — the same UX sign-up already gives its owner.
   */
  async acceptInvitation(
    token: string,
    input: Valid<typeof AcceptInvitationBody>,
  ): Promise<AuthenticatedSession> {
    return this.tenancy.withoutCompanyScope(
      'Accepting an invitation creates the very account that would establish company scope, ' +
        'so it has to run before one exists — the same reasoning sign-up already follows.',
      () => this.completeAcceptance(token, input),
    );
  }

  private async completeAcceptance(
    token: string,
    input: Valid<typeof AcceptInvitationBody>,
  ): Promise<AuthenticatedSession> {
    const invitation = await this.liveInvitation(token);

    if (await this.prisma.user.findUnique({ where: { email: invitation.email } })) {
      throw emailAlreadyRegistered();
    }

    const passwordHash = await hashPassword(input.password);

    const { user, company } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          companyId: invitation.companyId,
          name: input.name,
          email: invitation.email,
          passwordHash,
        },
      });

      if (invitation.roleId) {
        await tx.userRole.create({
          data: {
            companyId: invitation.companyId,
            userId: created.id,
            roleId: invitation.roleId,
          },
        });
      }

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      const company = await tx.company.findUniqueOrThrow({
        where: { id: invitation.companyId },
      });

      return { user: created, company };
    });

    // Never the owner — an invited colleague did not create the company — and whatever the
    // one role the invitation named grants, or nothing: identical to a colleague added and
    // left unassigned.
    const permissions = invitation.roleId
      ? (
          await this.prisma.rolePermission.findMany({ where: { roleId: invitation.roleId } })
        ).map((rolePermission) => rolePermission.permission)
      : [];

    return this.sessions.issue(user, company, permissions);
  }

  private async liveInvitation(token: string): Promise<Invitation> {
    const invitation = await this.prisma.invitation
      .findUnique({ where: { id: token } })
      .catch(() => undefined);

    if (!invitation || invitation.acceptedAt || invitation.expiresAt.getTime() <= Date.now()) {
      throw invitationInvalid();
    }

    return invitation;
  }
}
