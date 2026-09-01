import type { FrontendModuleManifest, FrontendRoute } from './module-manifest';

/**
 * Every module's frontend manifest, found rather than listed.
 *
 * `import.meta.glob` resolves at build time, so this is a static import list as far as the
 * bundler is concerned — nothing is loaded dynamically and nothing is lost to
 * tree-shaking — while still requiring no file to be edited when a module is added or
 * removed. It is the frontend's answer to the backend's directory scan, and it has to be:
 * a page that appears only after somebody remembers to register it is a page that ships
 * missing.
 */
const modules = import.meta.glob<{ manifest?: FrontendModuleManifest }>(
  '../modules/*/manifest.ts',
  { eager: true },
);

export const manifests: FrontendModuleManifest[] = Object.entries(modules)
  // Sorted by file path so the route table is identical on every machine. Two modules
  // claiming one path is a build failure on the backend; here it would silently resolve to
  // whichever the filesystem happened to hand over first.
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([, module]) => (module.manifest ? [module.manifest] : []));

export const routes: FrontendRoute[] = manifests.flatMap((manifest) => [...manifest.routes]);

export function routeFor(path: string): FrontendRoute | undefined {
  if (path.startsWith('/public/crm/form/')) {
    return routes.find((route) => route.path === '/public/crm/form');
  }
  // A single lead lives at `/crm/leads/<id>` — a parameterised route the exact-match table
  // cannot express. Matched here, ahead of the exact lookup, so the id segment resolves to the
  // workspace while `/crm/leads` itself (no segment) still falls through to the board index.
  if (/^\/crm\/leads\/[^/]+$/.test(path)) {
    return routes.find((route) => route.path === '/crm/leads/:id');
  }
  return routes.find((route) => route.path === path);
}
