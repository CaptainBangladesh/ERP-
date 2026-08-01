/**
 * The injection token for the assembled module graph.
 *
 * Platform code — the navigation endpoint today, the permission and tier checks in ticket
 * 07 — reads the graph through this rather than importing the manifests directly, so it
 * sees exactly what the application was assembled from and cannot drift from it.
 */
export const MODULE_REGISTRY = Symbol('MODULE_REGISTRY');
