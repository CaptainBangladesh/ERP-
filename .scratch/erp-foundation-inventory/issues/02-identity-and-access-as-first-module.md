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

**Status:** ready-for-agent

- [ ] A module declares a manifest: name, tier, dependencies, routes, migrations, permissions,
      navigation, events
- [ ] Routes, navigation and migrations are assembled from manifests with no central list to edit
- [ ] Migration order across modules is derived from declared dependencies and is deterministic
- [ ] A dependency cycle, a missing dependency, or a Core module depending on a higher tier all
      fail the build with a message naming the problem
- [ ] The application boots with any subset of modules present
- [ ] Identity and access is a Core module registered purely through its manifest
- [ ] Sign-up creates a company and its first user in one step
- [ ] The company creator is the owner; owner status derives from creation, not seeded data
- [ ] Sign-in establishes a session carrying the user and their company
- [ ] Home screen shows the signed-in user and company, with navigation and sign-out
- [ ] Sign-out ends the session and returns to sign-in
- [ ] Endpoints require a valid session by default; opting out is explicit and rare
- [ ] Unauthenticated and expired requests are refused with a consistent, clear error
- [ ] An expired session returns me to sign-in rather than failing silently
- [ ] Passwords are stored hashed and are never recoverable
- [ ] Sign-up validates inputs and shows errors against the offending fields
- [ ] Duplicate email registration is refused clearly
- [ ] The manifest format and how to add a module are documented
- [ ] Backend tests cover sign-up, sign-in, and refusal of unauthenticated and expired requests
- [ ] Frontend tests cover sign-up, sign-in, validation errors, and the signed-in home screen
