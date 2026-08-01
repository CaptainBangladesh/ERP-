# Modules

Everything with rules, tables, or screens is a module. The application is nothing but the
modules it finds plus a thin platform underneath them.

Nothing central lists the modules. The backend scans `backend/src/modules/*` for a manifest;
the frontend resolves `application/src/modules/*/manifest.ts` at build time. Adding a module
means creating a directory. Removing one means deleting it.

That is not tidiness. The roadmap is forty-plus modules, so every manual registration step is
paid forty times, and the first time somebody forgets one the failure is a module that
silently does not load.

## Adding a module

Copy `backend/src/modules/identity`. It is the worked example, and it is a real module rather
than a template kept alive alongside real ones.

`backend/src/modules/hrm` is the other one worth reading, and for the opposite reason: it is
the shape stub, deliberately unlike inventory, and it is the module that shows what
company-owned tables, a restricted field, and records that cannot be edited look like from
inside a module. Note what is *not* in it — there is no company filter anywhere.

```
backend/src/modules/<name>/
  <name>.manifest.ts     what the module declares about itself
  <name>.module.ts       the Nest module
  <name>.controller.ts   its endpoints
  <name>.service.ts      its behaviour — never exported to other modules
application/src/modules/<name>/
  manifest.ts            which component renders which path
  pages/                 the screens
  components/            pieces used by more than one of its own screens
```

Then:

1. Add your models to `backend/prisma/schema.prisma` under a heading naming your module.
2. Classify each new model in `backend/src/platform/tenancy/company-owned.ts` — company-owned
   or explicitly not, with a reason. See [tenancy.md](tenancy.md). The application refuses to
   boot until you have, so this is not a step you can skip by forgetting it.
3. Generate the migration, and declare its directory name in the manifest's `migrations`.
4. Run `npm run check:modules`. It will tell you what is wrong with the manifest, by name.
5. Write the tests: HTTP-level in `backend/test/`, screen-level beside the page component.

## The backend manifest

```ts
export const manifest: ModuleManifest = {
  name: 'products',
  tier: 'core',
  dependsOn: ['identity'],
  nestModule: ProductsModule,
  routes: ['api/products'],
  migrations: ['20260815120000_products'],
  permissions: ['products:products:read', 'products:products:write'],
  navigation: [{ label: 'Products', path: '/products', order: 10,
                 permission: 'products:products:read' }],
  events: { emits: ['products.product.created'], consumes: [] },
};
```

| Field | What it means |
| --- | --- |
| `name` | Lowercase kebab-case, matching the directory. Also the permission namespace and event prefix. |
| `tier` | `core`, `enterprise`, or `custom`. A module may depend on its own tier or lower, never higher. |
| `dependsOn` | The modules it may reach. Injecting or listening to anything not named here is a lie the build cannot yet catch, but ticket 05's boundary lint will. |
| `nestModule` | Composed into the application graph in dependency order. |
| `routes` | The API base paths it owns, no leading slash. Two modules claiming one path fails the build. Declared, not derived: the assembler checks routes against each other, not against the controller prefixes that actually mount them, so a manifest can still under- or over-claim. Ticket 05's boundary enforcement is where static verification of that lands. |
| `migrations` | Prisma migration directories it owns. Must exist, must be owned by exactly one module, and must sort after every migration of everything it depends on. |
| `permissions` | `<name>:<resource>:<action>`, always in the module's own namespace. |
| `navigation` | Menu entries, assembled and served by `GET /api/navigation`. |
| `events` | What it emits and consumes. A consumed event must be emitted by a declared dependency. |

## What the build refuses

`npm run check:modules` runs in CI before the tests, without a database. The application
performs the same assembly at boot, so nothing can pass there and fail here.

- A module that depends on something not present
- A dependency cycle — the message names the whole cycle
- A module depending on a higher tier
- Two modules claiming one route, one migration, or one name
- A permission outside the module's own namespace, or in the wrong shape
- A navigation entry guarded by a permission the module never declared
- A consumed event no declared dependency emits
- A migration timestamped before one of its dependencies' migrations
- A declared migration directory that does not exist

Every message names the modules involved and what would resolve it. At forty modules,
"circular dependency detected" costs an afternoon and `identity → parties → identity` costs
a minute.

## The subset rule

Any **dependency-closed** subset of modules assembles and boots. Deleting inventory leaves
the application running; deleting products while inventory remains does not, and says so.

This is the deletion test from the spec: if removing a business module breaks the
foundation, the foundation depended on that module.

## The frontend manifest

Much smaller, deliberately. Everything decidable on the server is decided there —
navigation, permissions, tiers — because those are answers a client must not be trusted to
compute. What is left is the one thing the server cannot express: which component renders
which path.

```ts
export const manifest: FrontendModuleManifest = {
  name: 'products',
  routes: [{ path: '/products', component: ProductListPage }],
};
```

Routes are protected unless marked `public: true`, matching the backend's default. Sign-in
and sign-up are the whole legitimate use of `public`: they are the screens somebody with no
session must reach in order to get one.

## Endpoints are guarded by default

A global guard requires a valid session on every endpoint. Opting out is `@Public()` on the
handler — explicit, greppable, and rare.

The platform does not know how authentication works. It declares a `SessionAuthority` seam;
identity binds an implementation to it. That is what lets the guard protect every module's
endpoints without the platform importing a module, and what lets the application boot with
identity absent — nothing is bound, and every non-public endpoint refuses, which is the
right failure for a system with no way to tell who anyone is.

## What a module may not do

- Import another module's internals. Only its public surface, only if declared in
  `dependsOn`. Ticket 05 makes this a lint failure rather than a convention.
- Query another module's tables. Ask its public service, or listen for its events.
- Put a domain concept in `@erp/shared`. That package holds primitives with no business
  meaning, plus each module's wire contract under `modules/<name>/contract.ts` — request and
  response shapes only, so that an API change breaks the build in both workspaces rather
  than the user's screen.
- Insert a row outside a user's action. The running application seeds nothing, ever.
- Write a company filter. Scoping is the platform's, applied to every query — a module that
  wrote `where: { companyId }` by hand would be a module that could forget to. See
  [tenancy.md](tenancy.md).
- Use `$queryRaw` or `$executeRaw`. Raw SQL bypasses tenant scoping entirely, so
  `npm run check:tenancy` fails the build on it outside the test harness.

## Known exception

`20260731110551_skeleton_probe` is owned by no module. It predates the module system — it
created the ticket 01 walking skeleton's table, which the identity migration drops. It is
the only unowned migration and there will not be another.
