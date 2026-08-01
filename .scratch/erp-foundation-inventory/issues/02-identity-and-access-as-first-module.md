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
