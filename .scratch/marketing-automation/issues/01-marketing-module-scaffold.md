# 01 — Marketing Module Scaffold

Type: task
Status: closed

## Question

How should the new `marketing` module be scaffolded and wired into the ERP backend and frontend, respecting module tiering and conformance rules?

### Requirements
- [x] 1. Run `npm run new:module -- --name marketing --tier core --depends-on crm parties`.
- [x] 2. Verify module registration in `backend/src/app.module.ts`.
- [x] 3. Set up initial routing and navigation tab in `application/`.
- [x] 4. Ensure `npm run check:modules` and `npm run check:tenancy` pass.

## Resolution

- Updated `readRequest` in `backend/src/platform/generator/generate.ts` to support both space-separated (`--depends-on crm parties`) and comma-separated (`--depends-on crm,parties`) flag values, covered by unit tests in `backend/test/generator.spec.ts`.
- Scaffolded the `marketing` module via `npm run new:module -- --name marketing --tier core --depends-on crm parties`.
- Verified automatic module discovery and assembly via `discoverManifests()` wired into `backend/src/app.module.ts`.
- Generated and verified frontend manifest and routing in `application/src/modules/marketing/manifest.ts` and `application/src/app/AppShell.tsx`, with automated routing test coverage in `application/src/app/AppRoutes.test.tsx` and `application/src/modules/marketing/pages/MarketingPage.test.tsx`.
- Ran `npm run check:modules`, `npm run check:tenancy`, `npm run check:conformance`, and `npm run typecheck` — all passed cleanly with 8 modules in dependency order.

