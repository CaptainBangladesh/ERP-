import { Prisma } from '@prisma/client';
import type { Company, User } from '@prisma/client';
import type { ModuleTier, Session } from '@erp/shared';

/** What a token carries. Everything else about the caller is read from the database. */
export interface TokenPayload {
  sub: string;
  sid: string;
  cid: string;
}

/**
 * Every role a user holds and every permission each one grants, read in the same query as the
 * user and their company. Nested reads are not scoped by the tenancy extension (docs/tenancy.md
 * — an `include` is executed as part of its parent's query) so this needs no scope suspension
 * to reach `Role`/`RolePermission`, the same way `authenticate` has always reached `Company`
 * through `user`.
 */
export const WITH_ROLES = {
  userRoles: { include: { role: { include: { permissions: true } } } },
} satisfies Prisma.UserInclude;

export type UserWithRoles = User & {
  userRoles: Array<{
    role: { id: string; name: string; permissions: Array<{ permission: string }> };
  }>;
};

/**
 * The one description of a caller, so sign-up, sign-in, authentication and accepting an
 * invitation cannot disagree about what a user is — particularly about `isOwner`, which is
 * derived rather than stored and would be easy to compute several slightly different ways.
 *
 * `permissions` is handed in rather than computed here: the owner's is `'all'` unconditionally,
 * decided by the caller before it ever needs a role loaded, and everybody else's is the union
 * `permissionsOf` found on the query each call site already ran.
 */
export function describe(
  user: User,
  company: Company,
  permissions: 'all' | string[],
): Omit<Session, 'expiresAt'> {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isOwner: company.ownerUserId === user.id,
    },
    company: { id: company.id, name: company.name, tier: company.tier as ModuleTier },
    permissions,
  };
}

/**
 * Every permission this user holds, from every role they hold, deduplicated. `'all'` is never
 * returned from here — that is the owner's unconditional bypass, decided by the caller, and
 * folding it into this function would make an ordinary colleague's permissions depend on a
 * branch this function has no business taking.
 */
export function permissionsOf(user: UserWithRoles): string[] {
  const permissions = user.userRoles.flatMap((userRole) =>
    userRole.role.permissions.map((rolePermission) => rolePermission.permission),
  );
  return [...new Set(permissions)].sort();
}
