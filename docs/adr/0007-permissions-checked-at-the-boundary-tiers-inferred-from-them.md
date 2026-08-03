# 0007 — Permissions checked at the boundary, and tiers inferred from them

**Status:** Accepted, 2026-08-03 (ticket 07)

## Context

Until now authorization was a placeholder the code itself flagged: `TenancyGuard` derived a
caller's grants as `session.user.isOwner ? 'all' : new Set()`. The owner held everything and a
colleague held nothing, which was honest — there were no roles to read — but it meant no
endpoint checked a specific permission and nothing enforced module tiers, though every manifest
had declared one since ticket 02.

Four questions were open, and each had a plausible wrong answer that would have been expensive
at forty modules.

1. **Where is a permission checked, and what stops an endpoint being left unguarded?**
2. **How does a module become unavailable to a company below its tier without every module
   learning what a tier is?**
3. **Does a person hold one role or several?**
4. **What ends the sign-up-with-no-way-back-in gap ticket 02 left, and does that mean building
   email?**

## Decision

### 1. One decorator per handler, and a build check that refuses a handler with none

`@RequirePermission('module:resource:action')` on every handler; `@Public()` for the handful
reachable with no session; `@NoPermissionRequired('reason')` for the few that need a session and
nothing more specific — reading your own session, signing out, reading a menu that filters
itself. `AccessGuard` is the third global `APP_GUARD`, after `SessionGuard` and `TenancyGuard`,
which is what makes `tenancy.holds(...)` meaningful by the time it runs.

The conformance pack gains `permission-declared`: a controller handler with none of the three is
a build failure. That rule is the whole reason this is a mechanism rather than a convention —
an unguarded handler works perfectly today, for an owner who holds everything, and refuses
nothing on the day somebody is given a role that omits it. The failure is silent in exactly the
way ADR 0005's other rules are, which is what earns it a place beside them.

**The rule keys off `@Controller`, not off a path.** It is the one pack rule that does not run
per module, because two gaps open if it does: the platform serves endpoints of its own
(navigation, the permission catalogue) and they need guarding for the same reason a module's do,
and a handler in a file nobody thought to call `*.controller.ts` is precisely the case where
being unguarded and being unnoticed coincide. Recognising the decorator closes both at once.

**`AccessGuard` refuses a handler that declares nothing**, rather than letting it through. The
pack should make that unreachable; failing closed is what makes "should" not matter. Guarded by
default is the posture everywhere else here, and an undeclared handler is not an exception to it.

### 2. A permission's own prefix is which module it belongs to

`AccessGuard` reads the required permission, takes the module name from the string's first
segment, looks that module's `tier` up in `MODULE_REGISTRY`, and refuses `module_unavailable`
when the company's tier ranks below it. Only then does it check the permission itself.

This is what makes "no module needs to know tiers exist" true rather than aspirational. There is
no second declaration for tier availability to drift from: the string a module already writes for
an unrelated reason — `hrm:pay-runs:write` — is also how the platform knows the endpoint is
hrm's. Navigation filters by the same two facts, in the same one place.

The company's tier is read fresh from the database on every request, through the session the
`SessionAuthority` resolves. Nothing caches it, which is what makes "changing a company's tier
changes what it can reach, without a restart" a property of the design rather than a claim needing
a cache-invalidation story.

**Dependency-driven unavailability needs no separate mechanism.** Tiers are totally ordered and
`assembleModules` already refuses a module depending on a higher tier than its own, so a module's
dependency is never unreachable to a company that can reach the module. The observable case is
the converse — a Core-tier company reaches `products` and is refused `warranties` — and
`warranties.spec.ts` asserts it with a comment recording why nothing further is required.

### 3. Several roles per person, unioned

A `UserRole` row per role held; permissions are the union. `RolePermission` is a row per
permission rather than an array column, mirroring `PartyRole` — the one multi-valued-relation
precedent already in this schema.

**The owner's `'all'` is not a role.** It is derived from having created the company, the same way
`isOwner` always has been, and it is unconditional — which is what makes "the company creator
cannot be locked out" a fact rather than a rule somebody could revoke by editing the wrong role.
`roles.spec.ts` asserts it by assigning the owner a role granting almost nothing and finding them
unaffected.

**Denying a whole module is not a separate switch.** It is holding none of that module's
permission strings, which is the state the role screen's per-module "select all / clear" control
reaches in one click. A second mechanism for it would be a second thing to keep in step with the
first.

### 4. Recovery rides along, through one faked mail seam

Inviting a colleague already needs email delivery and a single-use, expiring token; a password
reset needs the same two things. Building them together is the cheaper half of the work, and the
spec's deferral of "email and notifications" is explicitly *beyond what authentication requires*.

`platform/mail` declares a `Mailer` seam with exactly one implementation, `DevMailer`, which logs
and keeps what it "sent" in memory. Nothing else is ever bound — "faked in tests and in
development" means faked everywhere, and a test recovers a token by reading the message the way a
real recipient would rather than by reaching into the database.

`Invitation` and `PasswordReset` follow `Session`'s precedent: the row's `id` *is* the bearer
token, an unguessable UUID looked up directly, so there is no second hashing scheme to invent.
Both are company-owned; the one lookup that runs before a session exists uses
`withoutCompanyScope` with a written reason, exactly as sign-in already does to find a `User` by
email across companies.

Forgot-password always answers 204 and sends mail only when an account exists — the same
anti-oracle shape sign-in already applies to a wrong password. Resetting revokes every session the
account held.

**Sign-up's confirm-password field is gone.** It existed only because a typo was unrecoverable
for the first and only user of a brand-new company. Recovery is what closed that, and `Field`'s
existing reveal toggle is what remains to guard against a typo — one box instead of two to keep in
step.

## Consequences

- Every existing module's controllers gained one decorator per handler. Nothing else in them
  changed, which is the point: authorization is at the boundary, not threaded through services.
- `docs/tenancy.md`'s open question — who may *write* a restricted field — is settled: writing
  `annualSalary` needs `hrm:employees:write`, like any other employee field. Restriction governs
  reading only. A caller with write and without `hrm:pay:read` can set a salary and never see it
  back, which is coherent and needed no new permission.
- The generator's controller template writes `@RequirePermission` on every handler, so a module
  generated tomorrow passes `permission-declared` on the day it exists.
- Two axes now refuse a caller and they are deliberately distinct: `forbidden` (you lack the
  permission) and `field_restricted` (you named a column you may not read, ADR 0004). Neither
  subsumes the other — a caller can hold `hrm:employees:read` and still not see a salary.
- Tests that arrange "a colleague" must now say what that colleague holds.
  `factories.addColleague` takes permissions, and the two suites that predate roles pass the HRM
  permissions explicitly — so they keep proving what they say they prove (a colleague who may use
  HRM and may not see pay) rather than one who cannot reach HRM at all.
- The frontend's `session.permissions` decides only what to render. The API checks again on every
  request; nothing trusts the client's copy, which is why the permission catalogue is not
  sensitive and `GET /api/permissions` needs no permission of its own.

## Alternatives considered

**A `tier` field on each endpoint, or a second manifest declaration for availability.** Rejected:
a second declaration is a second thing to forget, and the permission prefix already carries the
module identity exactly and for free.

**One role per person.** Simpler to merge — there is nothing to merge — but the union is what lets
a company compose "reads parties" and "reads products" without defining a third role for every
combination, and the join table is the shape this schema already uses once.

**Checking permissions in services rather than at the boundary.** Rejected on the spec's own terms
("checked at the API boundary in one consistent way, so that no endpoint is accidentally left
unguarded") and because a check inside a service cannot be verified by a build step that reads
controllers.

**A real mail provider behind the seam.** Out of scope, and the seam is what makes adding one
later a binding change rather than a code change. `DevMailer` in production is a deliberate,
recorded state, not an oversight — this system sends exactly two emails and both are
authentication.
