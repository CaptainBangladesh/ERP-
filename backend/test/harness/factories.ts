import type { PrismaClient } from '@prisma/client';

/**
 * Test data factories.
 *
 * This is the ONLY place data is created without a user typing it. The running application
 * seeds nothing — not at startup, not in migrations — so factories exist purely to arrange
 * test state.
 *
 * Prefer arranging state through the API where the endpoint exists: a company and its owner
 * come from `POST /api/auth/sign-up`, not from here, because a factory that built them
 * would build them slightly differently from the way the application does and the tests
 * would quietly stop describing the real system. Reach for a factory only for states the
 * API deliberately offers no way to reach.
 */
export interface Factories {
  /**
   * Back-dates every session a user holds, so their next request arrives with an expired
   * one.
   *
   * There is no endpoint for this and there should not be. The alternatives are waiting
   * twelve hours, or making the session lifetime configurable — a production setting that
   * would exist only to serve the suite, and would eventually be set wrong in production.
   */
  expireSessions: (userId: string) => Promise<void>;

  /**
   * Puts a second person in a company, sharing the owner's password.
   *
   * There is no endpoint for this yet — inviting colleagues is user story 17 and arrives
   * with roles in ticket 07 — and the state is needed now, because "the owner sees salaries
   * and a colleague does not" cannot be asserted with only one user per company.
   *
   * The password is copied from the owner rather than hashed here on purpose: the harness
   * has no business knowing how identity stores passwords, and copying a hash it never
   * reads keeps that true. The colleague signs in with whatever the owner signed up with.
   */
  addColleague: (input: {
    ownerUserId: string;
    name: string;
    email: string;
  }) => Promise<{ id: string }>;
}

export function createFactories(prisma: PrismaClient): Factories {
  return {
    expireSessions: async (userId: string) => {
      await prisma.session.updateMany({
        where: { userId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    },

    addColleague: async ({ ownerUserId, name, email }) => {
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerUserId } });

      return prisma.user.create({
        data: {
          companyId: owner.companyId,
          name,
          email,
          passwordHash: owner.passwordHash,
        },
        select: { id: true },
      });
    },
  };
}
