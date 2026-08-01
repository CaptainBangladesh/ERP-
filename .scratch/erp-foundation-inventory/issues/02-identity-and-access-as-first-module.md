# 02 — Identity and access, as the first manifest-driven module

**What to build:** The way into an empty system — and, by building it, the module contract itself.

From the sign-up screen I create a company and my own user account, sign in, and land on a home
screen showing who I am and which company I am in. I can sign out. Nothing is seeded; the first
company in the database is the one I create.

Identity and access is built as a **Core module declaring a manifest**: its name, tier,
dependencies, routes, migrations, permissions, navigation entries, and events. The application
assembles itself from manifests, so there is no central registry to edit when the next module
arrives. The manifest is designed here rather than in the abstract, because it is easier to get
right while a real module is being fitted to it.

**Blocked by:** 01 — Walking skeleton and test harnesses

**Status:** done

- [x] A module declares a manifest: name, tier, dependencies, routes, migrations, permissions,
      navigation, events
- [x] Routes, navigation and migrations are assembled from manifests with no central list to edit
- [x] Migration order across modules is derived from declared dependencies and is deterministic
- [x] A dependency cycle, a missing dependency, or a Core module depending on a higher tier all
      fail the build with a message naming the problem
- [x] The application boots with any subset of modules present
- [x] Identity and access is a Core module registered purely through its manifest
- [x] Sign-up creates a company and its first user in one step
- [x] The company creator is the owner; owner status derives from creation, not seeded data
- [x] Sign-in establishes a session carrying the user and their company
- [x] Home screen shows the signed-in user and company, with navigation and sign-out
- [x] Sign-out ends the session and returns to sign-in
- [x] Endpoints require a valid session by default; opting out is explicit and rare
- [x] Unauthenticated and expired requests are refused with a consistent, clear error
- [x] An expired session returns me to sign-in rather than failing silently
- [x] Passwords are stored hashed and are never recoverable
- [x] Sign-up validates inputs and shows errors against the offending fields
- [x] Duplicate email registration is refused clearly
- [x] The manifest format and how to add a module are documented
- [x] Backend tests cover sign-up, sign-in, and refusal of unauthenticated and expired requests
- [x] Frontend tests cover sign-up, sign-in, validation errors, and the signed-in home screen

## Comments

**2026-08-01 — no way back in. Owed by ticket 07.**

This ticket shipped sign-up, sign-in and sign-out, and no account recovery. That leaves a real
hole rather than a missing nicety: the company creator is the first and only user of a company
nobody else can reach, so a forgotten or mistyped password locks them out of it permanently, with
no reset link and no colleague who could let them back in.

It was not built here because recovery needs email delivery and a single-use expiring token, and
neither exists yet. Ticket 07 introduces both anyway for colleague invitations, so recovery has
been added to that ticket rather than given one of its own — the standing rule is that
infrastructure rides along with the first visible feature that needs it. Ticket 07's own criterion
*"the company creator always retains full access and cannot be locked out"* is not met until this
is done.

Two things in this ticket's UI exist only because of the gap, and both should be revisited when
07 closes:

- **The confirm-password field on sign-up.** With a reveal toggle it is otherwise redundant —
  GOV.UK removed theirs for exactly this reason. It is here only because a typo is currently
  unrecoverable.
- **The wording on the sign-in screen**, which offers no "forgot your password?" route because
  there is nothing to offer.

Nothing is deployed, so the exposure today is limited to development. It must not reach a real
user in this state.
