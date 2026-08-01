# ADR 0001 — Modules declare manifests; the application assembles itself

Status: accepted (ticket 02)

## Context

The roadmap is forty-plus modules across three tiers. The conventional Nest approach is a
root module with an import list, a central permissions constant, a route table, and a
navigation array — four lists that every new module edits.

Four edits times forty modules is a hundred and sixty chances to forget one, and forgetting
one produces a module that silently does not load, a permission nobody can grant, or a
screen with no way to reach it. None of those fail loudly.

The spec also requires a deletion test: excluding any business module must leave the
application building and booting. A central import list makes that a manual edit too.

## Decision

Every module declares a manifest: name, tier, dependencies, routes, migrations, permissions,
navigation, and events. The application discovers manifests by looking — a directory scan on
the backend, `import.meta.glob` on the frontend — and assembles routes, migrations,
navigation, and the Nest module graph from them.

`assembleModules` is a pure function over declarations. It runs at boot, and separately in
CI as `npm run check:modules` with no database, so a graph that cannot be assembled fails
the build rather than a deployment.

Migration order is derived from the dependency graph, with ties broken on module name so
the order does not vary with filesystem order between a laptop and CI. Because Prisma
applies migrations in name order and knows nothing about modules, the assembler additionally
checks that timestamps agree with the dependency order.

## Consequences

- Adding a module is creating a directory; removing one is deleting it.
- Any dependency-closed subset boots. Removing something still depended upon fails with a
  message naming both modules.
- The failure messages are a deliverable, not a detail. Each names the modules involved and
  what would resolve the problem.
- The assembler is the one place in the suite tested below the HTTP boundary, because its
  deliverable is its refusals and a refused application never starts to be driven over HTTP.
- Discovery is filesystem-shaped, so a bundler that rewrites `require` would break it. The
  backend compiles with plain `tsc` via the Nest CLI, which preserves the layout. Adopting a
  bundled backend build would mean revisiting this.

## Alternatives considered

**A central registry file.** Simpler to read, and the thing this exists to avoid. It has to
be kept in step with the filesystem by hand, forty times.

**Decorator-based auto-registration.** Nest's own idiom, but a decorator cannot be read
without executing the module, so the build check would need to boot the application — and
the whole point is to fail before anything boots.
