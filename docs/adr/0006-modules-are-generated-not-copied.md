# 0006 — Modules are generated, not copied

**Status:** Accepted, 2026-08-03 (ticket 06)

## Context

The roadmap is forty-plus modules. Until now, adding one meant copying `identity` and
following six steps in `docs/modules.md`: models into the schema, a classification into
`company-owned.ts`, a migration, a manifest, an `index.ts`, a contract in the shared package,
a frontend manifest, tests.

Every one of those steps is paid forty times. More to the point, none of the ways to get one
wrong fails loudly on the day it is written:

- a hand-rolled `?limit=` compiles and breaks the shared table on somebody else's screen;
- a missing tenancy classification refuses the boot, but only after the table exists;
- a contract that is not `ListResponse<T>` type-checks and cannot be driven by the shared
  table;
- a manifest that under-claims its migrations passes every check until a deploy applies them
  in the wrong order.

The conformance pack (ADR 0005) refuses most of these. But a pack refuses at the *end* of the
work, and refusal is a poor teacher when the same person is about to do the same thing
thirty-nine more times. Consistency at that scale cannot come from discipline.

Two orderings were available: write the generator first, or extract it from modules that
already exist. This ticket is deliberately the sixth rather than the second.

## Decision

**A generator produces new modules, and it is the only supported way to add one.**
`npm run new:module -- --name <name> [--tier …] [--depends-on …] [--record …]`.

**It was extracted from three working modules rather than written ahead of them.** Identity,
hrm and parties were built by hand, and what they turned out to need is what the templates
contain. A generator written before any module existed would have encoded guesses — and every
module after it would have inherited them.

**What it produces is a working module, not a skeleton.** A table, a list endpoint under the
platform's conventions, a create form, a screen with its empty state, HTTP tests and screen
tests. It passes `check:modules`, `check:conformance` and both suites the moment it exists, so
the first act on a new module is changing working code rather than filling in blanks. A
skeleton with `TODO` in it would leave exactly the decisions that need to be consistent —
paging, scoping, error shape — to whoever is writing the eleventh module at four in the
afternoon.

**It also makes the three edits a directory cannot express**: the model in `schema.prisma`,
its classification in `platform/tenancy/company-owned.ts`, and the contract's export in
`packages/src/index.ts`. These are the steps most easily forgotten and the ones whose failures
are least legible.

**It refuses before it writes.** A duplicate name, an absent dependency, a Core module
reaching up a tier, a record another module owns, a name that could not be a directory. Every
target is checked and every patch applied in memory first: half a generated module is worse
than none, because the person who asked for it has no list of what to undo.

**The plan is a pure function.** `planModule(request)` answers with files and patches and
opens nothing; `write.ts` is the only part that touches a disk. That is the same split ADR
0005 made for the conformance pack, and it buys the same thing: `test/generator.spec.ts` hands
what the generator *would write* to `assembleModules` and `checkConformance` — the same two
functions the build runs — and so "a generated module is conformant" is a test that runs in
milliseconds rather than one that writes eleven files into the working tree and hopes to clean
up after itself.

**Products is the first module produced by it**, and is in the repository as generated and
then filled in. That is the standing proof that generated code compiles and boots: it is built
by `npm run build` and exercised by the suite like everything else.

## Consequences

The templates are text, not type-checked as they are written. A template that produced
non-compiling code would be caught by the next module generated from it rather than at the
moment of the mistake. Products is the mitigation — a real module, generated, in the build —
and it is worth stating plainly rather than implying the templates are checked.

Templates drift from the modules they were extracted from. Nothing detects it: the generator
is not re-run against existing modules, and a convention that changes in `parties` will not
change here. The signal to update them is a module review noticing that the generated starting
point is no longer what a good module looks like — and the cost of not noticing is one
module's worth of inconsistency, not forty, because the *next* generated module still starts
from the same place.

`templates.ts` holds a frontend module's source as text, including its import of
`@erp/shared/ui`, which the conformance pack refuses in any file under `backend/`. The rule is
right and reading import lines wherever they appear is what makes it hard to evade, so the
file takes an indirection — the specifier is a constant — rather than the rule taking an
exemption. An exemption would be a hole in a rule about the whole backend; this is one word in
one template.

The alternative considered and rejected was a `create-module` schematic through the Nest CLI.
It would generate the backend half and know nothing about the shared contract, the frontend
module, the tenancy classification or the manifest — which is to say it would automate the
part that was never the problem.
