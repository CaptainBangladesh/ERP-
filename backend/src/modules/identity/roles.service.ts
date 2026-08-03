import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RoleListResponse, RoleResponse, RoleSummary } from '@erp/shared';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { roleInUse, roleNotFound } from './errors';
import { CreateRoleBody, ROLE_LIST, UpdateRoleBody } from './schemas';

/**
 * Roles: named sets of permissions, assigned to however many people a company wants to hold
 * one. A person may hold several — their permissions are the union of every role they hold,
 * resolved once per request in `session-shape.ts`.
 */
@Injectable()
export class RolesService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async createRole(input: Valid<typeof CreateRoleBody>): Promise<RoleResponse> {
    const role = await this.prisma.role.create({
      data: companyApplied<Prisma.RoleUncheckedCreateInput>({ name: input.name }),
    });

    if (input.permissions.length > 0) {
      await this.prisma.rolePermission.createMany({
        data: input.permissions.map((permission) =>
          companyApplied<Prisma.RolePermissionUncheckedCreateInput>({
            roleId: role.id,
            permission,
          }),
        ),
      });
    }

    return this.roleDetail(role.id);
  }

  async listRoles(query: Record<string, unknown>): Promise<RoleListResponse> {
    const slice = listQuery(query, ROLE_LIST);

    const [roles, total] = await Promise.all([
      this.prisma.role.findMany({
        ...slice.findMany<Prisma.RoleFindManyArgs>(),
        include: { permissions: true },
      }),
      this.prisma.role.count(slice.count<Prisma.RoleCountArgs>()),
    ]);

    return slice.respond(roles.map(describeRole), total);
  }

  async roleDetail(id: string): Promise<RoleResponse> {
    const role = await this.prisma.role.findFirst({
      where: { id },
      include: { permissions: true },
    });
    if (!role) throw roleNotFound();
    return describeRole(role);
  }

  /**
   * Renames a role, replaces its permissions wholesale, or both.
   *
   * A permission list is replaced rather than diffed: the list *is* the role's whole state, so
   * a change is "this is now the set", and a caller computing an add/remove diff against
   * whatever the role happened to hold a moment ago is a caller doing this module's job.
   */
  async changeRole(id: string, input: Valid<typeof UpdateRoleBody>): Promise<RoleResponse> {
    await this.roleDetail(id);

    if (input.name !== undefined) {
      await this.prisma.role.update({ where: { id }, data: { name: input.name } });
    }

    if (input.permissions !== undefined) {
      const permissions = input.permissions;
      await this.prisma.$transaction([
        this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
        ...(permissions.length > 0
          ? [
              this.prisma.rolePermission.createMany({
                data: permissions.map((permission) =>
                  companyApplied<Prisma.RolePermissionUncheckedCreateInput>({
                    roleId: id,
                    permission,
                  }),
                ),
              }),
            ]
          : []),
      ]);
    }

    return this.roleDetail(id);
  }

  /**
   * Refuses while anybody holds the role, letting the database's own `RESTRICT` on
   * `UserRole.roleId` speak rather than checking first — the same shape
   * `HrmService.removeEmployee` already uses for pay history.
   */
  async removeRole(id: string): Promise<void> {
    await this.prisma.role.delete({ where: { id } }).catch((cause: unknown) => {
      if (cause instanceof Prisma.PrismaClientKnownRequestError) {
        if (cause.code === 'P2003') throw roleInUse();
        if (cause.code === 'P2025') throw roleNotFound();
      }
      throw cause;
    });
  }
}

export function describeRole(role: {
  id: string;
  name: string;
  permissions: Array<{ permission: string }>;
}): RoleSummary {
  return {
    id: role.id,
    name: role.name,
    permissions: role.permissions.map((rolePermission) => rolePermission.permission).sort(),
  };
}
