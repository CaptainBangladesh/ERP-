# 13 — Design system, navigation, and accessibility

Type: task
Status: resolved
Blocked by: 11, 12

Phase 3 of 3. Last on purpose: 13.1 rewrites nine components, and doing that before ticket 11
lands means doing it twice.

Audit and scoring model: `.scratch/marketing-automation/hardening-and-design-research.md`.

**Start here:** the UI craft in this module is good — the Instagram grid simulator, the
engagement heatmap, the live character meters, the empty states with real guidance. This ticket
is not about taste. It is that almost none of it is built from the system this repo already has,
and that the interactions are mouse-only.

---

## 13.1 — Adopt the shared design system

| | files importing `@erp/shared/ui` | total |
|---|---|---|
| crm | 22 | 62 |
| **marketing** | **1** | **14** |

Only `MarketingPage.tsx` imports it. Nine components hand-roll a `fixed inset-0` modal overlay
while `@erp/shared/ui` exports a `Modal`:

```
BrandSwitcher, InstagramGridPreviewModal, JobQueueMonitor, LeadGenManager, PostComposerModal,
PublishingManager, SocialAccountsVault, SocialInboxManager, TrackingManager
```

`Button`, `Field`, `Select`, `FormError` are likewise available and unused. This is why the
module will drift visually the first time anyone improves a shared component — nine private
copies of a modal do not receive the fix.

**Do:**
- Replace the nine overlays with `Modal`. **This is also most of 13.3** — it delivers focus trap
  and Escape across nine surfaces at once rather than as nine separate fixes.
- Replace ad-hoc buttons/inputs/selects with `Button` / `Field` / `Select` / `FormError`.
- Extract genuinely new reusables (platform-channel chip, character meter, status pill) once
  into the module rather than copying between its own components. If something belongs to every
  module, propose it for `@erp/shared/ui` — read that package's header first: what earns a place
  there is a primitive with no business meaning.

## 13.2 — Navigation and brand context

**The tab bar will break the layout.** `MarketingPage.tsx:115` is a plain `flex` holding nine
tabs — emoji, long labels, count chips — with **no `flex-wrap`, no `overflow-x-auto`, no
`shrink-0`**. Roughly 1,500px of tabs; they will crush or push the page wide. This repo has hit
this exact bug before in the CRM workspace.

**Nine copies of one button.** ~250 of that file's 444 lines are the same 12-line tab button
pasted nine times plus the same empty-state block pasted seven times.

**Tab state is invisible to the URL.** `activeTab` is `useState`, seeded by a one-shot
`window.location.pathname` read in the initialiser — so `/marketing/calendar` does not select
the calendar on client-side navigation, you cannot link someone to a tab, refresh loses your
place, and back does nothing.

**Brand context resets, and that is a mis-posting hazard.** `activeBrand` falls back to
`brands[0]` on every reload and is never persisted. Publishing to the wrong client's Instagram
is the single worst thing this product can do, and the category exists partly to prevent it.

**The repo already solved most of this:** `crm/pages/LeadWorkspace.tsx:342` has an extracted
`TabButton` with count support; `application/src/app/location.ts` provides `navigate` /
`useLocationPath` and `LeadWorkspace` uses them; `LeadWorkspace.tsx:525` persists tab state in
`localStorage`. Reach for these before writing new navigation code.

**Do:**
- Drive tab state from the URL via `app/location.ts`.
- Collapse the nine repeats into a `TABS` array and one `<EmptyState>`. 444 lines → ~120.
- Fix the overflow regardless of structure: `flex-wrap`, `overflow-x-auto`, `shrink-0`.
- Reconsider nine top-level destinations — past what a tab strip carries. Category research is
  consistent (Metricool's density is what new users struggle with; Buffer wins on "clean, at a
  glance"). Proposed: **Plan** (Calendar, Composer) · **Engage** (Inbox, DMs) · **Grow**
  (Campaigns, SmartLinks, Inbound) · **Settings** (Vault, Queue, Records).
- Persist the active brand *and* put it in the URL so a shared link carries its brand. Make
  brand identity loud on the composer's publish button, not a chip in a tab label. Confirm on
  publish when the target brand is not the one last used.
- Delete or rename "Campaign Records" — leftover ticket-01 scaffold CRUD sitting beside
  "Campaigns & Attribution" under a near-identical name.

## 13.3 — Accessibility

14 `aria-` / `role` attributes across ~9,000 lines of UI. `CampaignsManager` (1,361 lines): 0.
`SocialInboxManager`, `LeadGenManager`, `PublishingManager`, `TrackingManager`,
`JobQueueMonitor`, `SocialAccountsVault`: 0 each.

**The tabs are not tabs.** Nine plain `<button>`s. A screen reader announces nine unrelated
buttons with no indication they are one group, which is current, or what each controls. The
W3C APG Tabs pattern requires `role="tablist"` + `aria-label`; `role="tab"` + `aria-selected` +
`aria-controls`; `role="tabpanel"` + `aria-labelledby` + `tabindex="0"`; Left/Right arrows with
wrap; Home/End.

**Drag-and-drop has no keyboard path at all.** `SocialCalendarPage.tsx:500` and `:607` use
HTML5 `draggable` only. **A keyboard-only user cannot reschedule a post** — the headline feature
of ticket 05. Same gap in the Instagram grid reorder.

**Do:**
- Implement the APG Tabs pattern on the tab bar built in 13.2.
- Give every drag a non-drag equivalent: a per-post menu with "Reschedule…" opening a date/time
  field, and Move up/down on grid tiles. **Ship the menu first** — it is also faster for mouse
  users on a dense month view, which is why calendar products keep both affordances rather than
  treating one as a fallback.
- Verify 13.1 delivered focus trap and Escape across the nine dialogs, rather than re-solving it.
- Label icon-only controls, status pills, count chips.
- Add `jest-axe` so this cannot regress silently.

---

## Done when

- No hand-rolled `fixed inset-0` modal remains; `@erp/shared/ui` primitives used where one exists.
- The module is visually consistent with `crm`.
- The tab bar does not overflow at 1280px with a sidebar present.
- A tab is linkable, survives refresh, and responds to the back button.
- The active brand survives a reload; publishing to a different brand asks for confirmation.
- The tab bar passes the APG Tabs keyboard interaction set.
- A post can be rescheduled, and grid tiles reordered, using only the keyboard.
- `jest-axe` reports no violations on each marketing surface.
- `npm run test:app` passes.

**Tests ship with this ticket** — including the one the module never had: rescheduling a post by
drag *and* by keyboard, persisting via `PATCH /posts/:id`.

---

## Resolution (2026-09-07)

Implemented against decisions 13.0-13.4 in `map.md`.

**13.0** `brands.service` no longer maps social accounts itself: `SocialAccountsService.describeAccount`
is the one mapping, so the mask is of the decrypted plaintext at every call site. The response-body
walker in `marketing-hardening.spec.ts` now also fails on any leaf value matching a long
base64/hex blob, which is what would have caught this.

**13.1** All twelve `fixed inset-0` overlays across the nine components are `@erp/shared/ui`'s
`Modal`, adopted directly - no shim. This repository has no ESLint, so the mechanical ban is a
check that runs under `test:app`: `marketing-design-system.test.tsx` scans every source file under
the module and fails on `fixed inset-0` or a hand-written `role="dialog"`. The platform chip,
character meter and status pill are extracted to `components/MarketingPrimitives.tsx`, module-local.

**13.2** `MarketingPage` collapses to one `TABS` array, one `TabStrip` and one `EmptyState`. Tab
state derives from `useLocationPath()` over a closed allowlist; the brand travels as `?brand=<id>`,
resolved against the API's list, persisted as `marketing:activeBrand:<userId>` and cleared on
sign-out. Groups are Plan / Engage / Grow / Settings; the "Campaign Records" tab is gone and
`/marketing/records` still renders the scaffold. The cross-brand publish confirmation renders
handles fetched from the server for the target brand.

**13.3** APG Tabs live in `TabStrip` and are tested by pressing keys, not by reading attributes.
Drag, the per-post "Reschedule..." dialog and the keyboard all call one `reschedulePost`; the
server now validates the new time and re-checks a changed `socialAccountId` against the brand.
Instagram grid tiles gained Move-earlier/later buttons. `jest-axe` asserts zero violations on five
marketing surfaces.

### 13.4 Checks

| check | result |
|---|---|
| `npm run typecheck` | clean (no output) |
| `npm run check:modules` | Module contract OK - 8 module(s) in dependency order |
| `npm run check:tenancy` | Tenant scoping OK - no raw SQL outside 'test/harness' |
| `npm run check:conformance` | Module conformance OK - 8 module(s) and 451 source file(s) checked |
| backend marketing specs | `marketing-hardening` 20/20; vault + publishing + marketing + reliability 38/38 |
| `test:app` | 407 tests, 402 passed, 5 failed |

**Open:** the five `test:app` failures are in `crm/pages/PlaybooksPage.test.tsx` and
`crm/pages/TeamPlanningPage.test.tsx`. They fail identically with this ticket's changes stashed,
so they pre-date it and belong to the uncommitted CRM work in the tree - not to ticket 13.
