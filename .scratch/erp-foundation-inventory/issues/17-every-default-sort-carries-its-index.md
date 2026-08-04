# 17 — Every default sort carries its index

**What to build:** A build check that refuses a list endpoint whose default sort has no index
behind it.

ADR 0004 chose offset paging over cursor paging, and the argument turned on one condition it
stated as "a real obligation and not a hope": every list endpoint's default sort carries an index
on `(company_id, <sort column>)`. Without it the database sorts the whole company's rows to answer
for twenty-five of them, and the offset is then the least of it.

Nothing enforces it. Six modules in, two endpoints already do not have it:

- `USER_LIST` defaults to sorting by `name`; `users` carries only `@@index([companyId])`.
- `INVITATION_LIST` defaults to `-createdAt`; `invitations` carries `[companyId]` and `[email]`.

Both are the least consequential possible instances — a company has between twenty and five
hundred users and fewer pending invitations, so neither will ever be slow. That is the argument
rather than a mitigation: the obligation drifted exactly where nobody would notice, which is what
a convention does. On `stock_movements`, where the roadmap expects six figures of rows per
company, it was not forgotten. The difference between those cases is attention, and attention is
what does not scale to forty modules.

The check is mechanical. Every module declares a `ListSpec` with a `defaultSort`, and
`Prisma.dmmf` declares every model's indexes and unique constraints. Comparing them is the same
shape of static check as every other rule in the conformance pack, and it runs on nothing in a
moment.

**Blocked by:** 14 — Foundation audit against the module roadmap

**Status:** ready-for-agent

- [ ] A list endpoint whose default sort has no supporting index fails `check:conformance`
- [ ] A composite unique constraint counts as an index when its leading columns match
- [ ] The message names the module, the endpoint, the column and the index to add
- [ ] `users` and `invitations` gain the indexes they are missing, by migration
- [ ] The rule is exercised in `conformance.spec.ts` against a spec that deliberately breaks it
- [ ] The whole repository passes the rule
- [ ] The generator produces a module whose default sort is indexed on the day it exists
- [ ] ADR 0004's obligation is amended to record that it is now checked

## Comments

**2026-08-04 — the one design question, and where the parts are.**

The specs are `LIST` constants in each module's `schemas.ts`, built by `listSpec` in
`backend/src/platform/list/`. The indexes are in `backend/prisma/schema.prisma` and readable at
runtime through `Prisma.dmmf.datamodel.models[].uniqueIndexes` and `[].primaryKey` — the same
source `assertEveryModelIsClassified` already reads, which is the precedent for a check knowing
about the datamodel.

The design question worth settling first: **the pack is pure over source text and the datamodel
is not source text.** `checkConformance` takes its inputs as an argument — `classifiedModels` and
`grantsByModel` are already passed in by `check.ts` rather than read inside — so the indexes go
the same way, and the rule stays a pure function that `conformance.spec.ts` can hand a deliberate
violation to. Follow that seam rather than importing Prisma into the rule.

The second is which model a spec sorts against, since a `ListSpec` names fields and not a table.
The module's manifest claims its `models`, and a list endpoint sorts against exactly one of them.
Adding the model name to the spec is one word per endpoint and makes the rule exact; inferring it
from the manifest is fewer edits and ambiguous the moment a module owns two tables with a list
each — which `inventory` and `products` both already do. Prefer the word.

See ADR 0009, finding 3, and ADR 0004, decision 2.
