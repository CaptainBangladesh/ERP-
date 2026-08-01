import type { PrismaClient } from '@prisma/client';

/**
 * Test data factories.
 *
 * This is the ONLY place data is created without a user typing it. The running application
 * seeds nothing — not at startup, not in migrations — so factories exist purely to arrange
 * test state.
 *
 * Prefer arranging state through the API where the endpoint exists; reach for a factory only
 * when the setup is not itself the thing under test.
 */
export interface Factories {
  skeletonProbe: (count?: number) => Promise<void>;
}

export function createFactories(prisma: PrismaClient): Factories {
  return {
    /** TEMPORARY — removed with the skeleton probe in ticket 02. */
    skeletonProbe: async (count = 1) => {
      await prisma.skeletonProbe.createMany({
        data: Array.from({ length: count }, () => ({})),
      });
    },
  };
}
