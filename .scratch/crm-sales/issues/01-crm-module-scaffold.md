# 01 — CRM module scaffold

**What to build:** Land the `crm` module for real — generated via `npm run new:module -- --name
crm --tier core --depends-on parties`, migration applied, manifest declaring `tier: core`,
`dependsOn: ['parties']`, and a navigation entry. No business behavior yet (no Lead/Deal/Activity
models) — this ticket exists so every following ticket has a legitimate module to build inside,
already passing every structural check, rather than each redoing the same setup.

Consult [the spec](../spec.md) for full context; this ticket covers none of its schema decisions,
only the module's existence.

**Blocked by:** None — can start immediately

- [x] `backend/src/modules/crm/` exists with the generated manifest, module, controller, service,
      schemas, and public surface (`index.ts`), matching the shape `docs/modules.md` describes.
- [x] Manifest declares `name: 'crm'`, `tier: 'core'`, `dependsOn: ['parties']`, and its migration.
- [x] The migration is applied cleanly to a fresh database via `npm run db:migrate`.
- [x] `npm run check:modules` and `npm run check:conformance` pass with `crm` present.
- [x] Both test suites (`npm test`) pass, including the generated `crm.spec.ts` smoke test.
- [x] A `Sales` (or `CRM`) navigation entry appears, gated by a `crm:*:read`-shaped permission,
      leading to an empty placeholder page — no real screen yet.

## Comments

**2026-08-23 — resolved, then immediately built on by ticket 02 the same day.** The generator
(`npm run new:module -- --name crm --tier core --depends-on parties`) initially produced a
broken scaffold: for a module name whose singular has no distinct plural, its `_PATHS` object
ended up with two properties both named `crm` (a TypeScript duplicate-key error, and a silent
runtime bug — the second key wins). Fixed at the source in
`backend/src/platform/generator/module-name.ts`/`templates.ts` (regression test in
`backend/test/generator.spec.ts`), then the scaffold was regenerated cleanly.

By the time this was verified, ticket 02 (Lead management) had already landed directly on top
of the placeholder scaffold — `leads.controller.ts`/`leads.service.ts` (named after the
resource, not the module, per `docs/modules.md`'s multi-resource convention), the `Lead` model
and migration, and a real Leads list/detail screen. So the navigation entry now reads "Leads"
and leads to a working screen rather than an empty placeholder — a superset of what this ticket
asked for, not a deviation from it. All structural checks (`typecheck`, `check:modules`,
`check:conformance`, `check:tenancy`) and both test suites pass with `crm` present.
