import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { InventorySettings, UpdateInventorySettingsRequest } from '@erp/shared';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';

/**
 * How strict this company's inventory is, which is the one thing about it a company chooses.
 *
 * The default — refusing a movement that would drive stock negative — is applied in code, on
 * the read, rather than by inserting a row at sign-up. That is the standing rule: nothing is
 * seeded into the running application, so a company that has never opened this screen has no
 * row here and still has a policy. The row appears the first time somebody changes their mind.
 *
 * Neither method takes the session, and none of them needs to: which company is asking is the
 * platform's business, applied to every query below by the tenant scope. A service that took a
 * session would be a service that could read the wrong company off it.
 */
@Injectable()
export class SettingsService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async get(): Promise<InventorySettings> {
    const row = await this.prisma.inventorySetting.findFirst();

    return {
      allowNegativeStock: row?.allowNegativeStock ?? false,
    };
  }

  async update(input: UpdateInventorySettingsRequest): Promise<InventorySettings> {
    const existing = await this.prisma.inventorySetting.findFirst();

    if (existing) {
      const updated = await this.prisma.inventorySetting.update({
        where: { id: existing.id },
        data: { allowNegativeStock: input.allowNegativeStock },
      });
      return { allowNegativeStock: updated.allowNegativeStock };
    } else {
      const created = await this.prisma.inventorySetting.create({
        data: companyApplied<Prisma.InventorySettingUncheckedCreateInput>({
          allowNegativeStock: input.allowNegativeStock,
        }),
      });
      return { allowNegativeStock: created.allowNegativeStock };
    }
  }
}
