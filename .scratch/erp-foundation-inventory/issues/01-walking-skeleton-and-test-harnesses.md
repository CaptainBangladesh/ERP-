# 01 — Walking skeleton and test harnesses

**What to build:** A running application I can open in a browser. One narrow path goes all the way
through: a React page fetches from the NestJS API, which reads from PostgreSQL via Prisma, and the
result renders on screen. Starting the whole thing is a single documented command.

Because nothing is ever seeded, the page starts against an empty database and shows a count of
zero. A button on the page creates a record, and the count becomes one. That proves the read path
and the write path through every layer without a single seeded row — and it is the first thing I
can click.

Both test seams work from this ticket onward: a backend test driving the real HTTP API against a
real PostgreSQL database with nothing mocked, and a frontend test rendering a page with the network
intercepted. Test data comes from factories in the harness — the running application seeds nothing.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Monorepo with three workspaces: shared package, NestJS backend, React frontend
- [ ] One documented command starts backend and frontend together
- [ ] A README states how to run the app and how to run the tests
- [ ] React page reads from the API against an empty database and shows a count of zero
- [ ] A button on the page creates a record through the API, and the displayed count updates
- [ ] The running application seeds no data, at startup or at migration
- [ ] Migrations create schema only; they never insert rows
- [ ] Tailwind is wired and applied; no component library is installed
- [ ] Prisma is wired with a migration workflow that runs on a clean database
- [ ] Backend harness boots the real app and drives it over HTTP against real PostgreSQL
- [ ] Each backend test runs against isolated database state
- [ ] Test data factories exist in the harness
- [ ] Frontend harness renders a page with HTTP intercepted and asserts on what is displayed
- [ ] One example test at each seam, both passing in CI
- [ ] Writing a new test at either seam takes only a few lines
