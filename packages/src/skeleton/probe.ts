/**
 * Skeleton probe — TEMPORARY.
 *
 * Ticket 01 must prove a read path and a write path through every layer (React → Nest →
 * Prisma → PostgreSQL) without seeding a single row. The probe is the smallest thing that
 * does that: the count starts at zero on an empty database, and creating a probe makes it
 * one.
 *
 * It is deliberately domain-free. Ticket 02 replaces it with the first real module
 * (identity and access) and deletes this file, its table, and its endpoints.
 */

export interface SkeletonProbe {
  id: string;
  createdAt: string;
}

export interface SkeletonProbeCount {
  count: number;
}

/** Mounted by the controller. No leading slash — Nest composes it. */
export const SKELETON_PROBES_ROUTE = 'api/skeleton-probes';

/** Requested by the client. Absolute, so it resolves against the app's own origin. */
export const SKELETON_PROBES_PATH = `/${SKELETON_PROBES_ROUTE}`;
export const SKELETON_PROBE_COUNT_PATH = `${SKELETON_PROBES_PATH}/count`;
