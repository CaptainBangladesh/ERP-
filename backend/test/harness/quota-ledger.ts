/**
 * An in-memory stand-in for the `SocialQuotaLedger` table.
 *
 * The publishing quota is one ledger shared by posts and competitor reads, so every path
 * through `publishing-quota.ts` — the publish guard included — reads the ledger row even when
 * the test under it has nothing to do with benchmarking. A hand-built Prisma double that
 * omits the delegate therefore fails with `Cannot read properties of undefined`, which says
 * nothing about the behaviour being tested. `QuotaClient` declares the delegate, but the
 * doubles are typed `any`, so the compiler cannot point this out; this file is what keeps the
 * two in step instead.
 *
 * It implements exactly the four calls the quota code makes, with the same semantics:
 * `findFirst` by account, the window roll and the two conditional `updateMany` claims, and
 * the seeding `create`. Anything else is deliberately absent — a double that quietly accepts
 * a query it does not model is worse than one that throws.
 */

export interface QuotaLedgerRow {
  id: string;
  companyId: string;
  socialAccountId: string;
  windowStartedAt: Date;
  competitorReads: number;
}

export interface QuotaLedgerDouble {
  rows: QuotaLedgerRow[];
  findFirst: (args: { where: { socialAccountId?: string } }) => Promise<QuotaLedgerRow | null>;
  updateMany: (args: { where: Record<string, any>; data: Record<string, any> }) => Promise<{ count: number }>;
  create: (args: { data: Record<string, any> }) => Promise<QuotaLedgerRow>;
}

/** `{ lt: x }` / `{ gt: x }` / a bare value — the comparisons the quota code actually writes. */
function matches(value: unknown, condition: unknown): boolean {
  if (condition === undefined) return true;
  if (condition !== null && typeof condition === 'object') {
    const c = condition as Record<string, any>;
    if ('lt' in c && !((value as any) < c.lt)) return false;
    if ('gt' in c && !((value as any) > c.gt)) return false;
    if ('lte' in c && !((value as any) <= c.lte)) return false;
    if ('gte' in c && !((value as any) >= c.gte)) return false;
    return true;
  }
  return value === condition;
}

/** `{ increment: n }` / `{ decrement: n }` / a bare value. */
function applied(current: unknown, update: unknown): unknown {
  if (update !== null && typeof update === 'object') {
    const u = update as Record<string, any>;
    if ('increment' in u) return (current as number) + u.increment;
    if ('decrement' in u) return (current as number) - u.decrement;
  }
  return update;
}

export function quotaLedgerDouble(seed: QuotaLedgerRow[] = []): QuotaLedgerDouble {
  const rows: QuotaLedgerRow[] = [...seed];

  const selected = (where: Record<string, any>) =>
    rows.filter((row) =>
      Object.entries(where).every(([field, condition]) =>
        matches((row as Record<string, any>)[field], condition),
      ),
    );

  return {
    rows,

    async findFirst({ where }) {
      return selected(where)[0] ?? null;
    },

    async updateMany({ where, data }) {
      const hit = selected(where);
      for (const row of hit) {
        for (const [field, update] of Object.entries(data)) {
          (row as Record<string, any>)[field] = applied((row as Record<string, any>)[field], update);
        }
      }
      return { count: hit.length };
    },

    async create({ data }) {
      const row: QuotaLedgerRow = {
        id: `quota-ledger-${rows.length + 1}`,
        companyId: data.companyId ?? 'company-1',
        socialAccountId: data.socialAccountId,
        windowStartedAt: data.windowStartedAt,
        competitorReads: data.competitorReads ?? 0,
      };
      rows.push(row);
      return row;
    },
  };
}
