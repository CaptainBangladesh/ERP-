# 02 — Lead management

**What to build:** A salesperson can record a Lead, edit it, and move it through its lifecycle:
mark it `contacted`, `disqualify` it (with the ability to `reopen` back to its prior status), and
`qualify` it into a real customer — either creating a new Party or linking an existing one — with
the resulting Party tagged `prospect` via the frontend composing Parties' own
`POST /parties/:id/roles` endpoint. Qualifying never auto-creates a Deal (always a separate,
explicit action). Full field list, status vocabulary, and the qualify contract are in
[the spec](../spec.md)'s "Lead schema and endpoints" section.

**Blocked by:** 01

- [x] `Lead` model + migration: name, organisation name, email, phone, source, status,
      `assignedToUserId`, `partyId` — as specified.
- [x] CRUD endpoints for Lead, permissioned under `crm:leads:*`.
- [x] `qualify` endpoint accepting `{action: 'create', ...}` or `{action: 'link', partyId}`,
      setting `partyId` and `status: 'qualified'` in one request.
- [x] `disqualify` / `reopen` endpoints round-trip correctly (reopen restores the stored prior
      status, not a guess).
- [x] Lead list screen (with empty state) and detail screen, including the qualify flow: creating
      or searching/picking a Party, then tagging it `prospect` via a second frontend call to
      Parties' role endpoint — never a backend write to `PartyRole`.
- [x] Assignment picker on the Lead detail screen resolves users by calling
      `GET /api/identity/users` directly and joining client-side (`crm`'s backend never resolves a
      username).
- [x] HTTP integration tests covering create, qualify (both `create` and `link`), disqualify/reopen,
      and tenant isolation (two companies, one Lead never visible to the other) — following
      `test/inventory.spec.ts`'s pattern.

## Comments

**2026-08-23 — resolved.** Built directly on ticket 01's scaffold in the same working session
(the module name, controller/service split, and PATHS collision fix from ticket 01 all landed
first). Verified end-to-end: `typecheck`, `check:modules`, `check:conformance`, `check:tenancy`
all pass; `backend/test/crm.spec.ts` covers the full Lead lifecycle including qualify-by-create,
qualify-by-link, the disqualify/reopen round-trip, refusing a second qualify, and tenant
isolation on every lifecycle endpoint; `LeadsPage.test.tsx` covers the list, the add form, and
the qualify flow's exact request sequence (create-or-link party → qualify → tag `prospect`).
