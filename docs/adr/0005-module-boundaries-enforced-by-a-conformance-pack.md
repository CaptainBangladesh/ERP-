# 0005 — Module boundaries, enforced by a conformance pack

**Status:** Accepted, 2026-08-03 (ticket 05)

## Context

Three modules exist and one of them — parties — is about to be consumed by all the others.
The roadmap is forty-plus. Until now "a module may use another's public surface and nothing
else" has been a sentence in `docs/modules.md`, enforced by nobody.

Conventions enforced by review decay in a predictable order. The reviewer who wrote the
convention notices the first violation, argues about the fifth, and stops seeing the
twentieth. What is left is a codebase whose real dependency graph is not the one anybody
wrote down — and a graph nobody wrote down is one nobody can delete a module from, which is
the property the whole foundation is built to preserve.

Ticket 04 also left two conventions with nothing behind them: every list endpoint returns
`ListResponse<T>` and accepts the platform's parameters, and every handler taking a body
declares its validator. Both fail quietly. A hand-rolled `?limit=` compiles and breaks the
shared table; a handler missing `validated(…)` accepts anything and says nothing.

## Decision

**A module's public surface is `src/modules/<name>/index.ts`.** Everything else in the
directory is internal. The file is required — a module with nothing to offer writes
`export {}` and a sentence saying so, which is a real answer rather than an omission.

**The rules are static checks over source text, run in CI as `npm run check:conformance`.**
They live in `backend/src/platform/conformance/` as pure functions over `{ path, text }` and
the assembled manifests, with one filesystem-touching module and one CLI entry point — the
same split as `assemble.ts` / `check.ts`.

The rules refuse:

- an import that reaches past another module's `index.ts`;
- an import of a module not named in `dependsOn`;
- a query against a table another module's manifest claims under `models` (new field);
- a module reaching inside a platform area rather than through its entry point;
- the platform importing a module — the dependency runs the other way, through a seam;
- the backend importing `@erp/shared/ui`;
- one frontend module's screens importing another's;
- an area of `@erp/shared` that is not a primitive, and a primitive that imports a contract;
- a module writing `companyId`, or naming `PrismaService`;
- a model no one classified in `company-owned.ts`, and a grant its owning module never declares;
- a named `@Query('…')`, a hand-written `skip`/`take`/`limit`/`offset`, and a `*ListResponse`
  that is not `ListResponse<T>`;
- a Nest built-in exception or `@Res()` in a module;
- `@Body()` without `validated(…)`.

**Every message names both modules and the permitted alternative.** That is a rule about the
rules. "Illegal import" tells somebody they are stuck; "parties imports hrm's internals;
import from `'../hrm'`, which is its public surface" tells them what to type.

**The pack is a test as well as a build step.** `backend/test/conformance.spec.ts` runs each
rule against a module that deliberately breaks it, and runs the whole pack against the real
tree with one assertion per module.

## Alternatives considered

**An ESLint plugin with `no-restricted-imports`.** It expresses the import rules well and
none of the others: it cannot see a Prisma delegate belonging to another module, a `PATCH`
handler with no validator, or a list type that is not the envelope. Splitting the rules
across two mechanisms would mean two places to look when something is refused. It is also
the failure mode this ADR exists to avoid one level up — a rule enforced by whoever has the
right editor extension installed is not a property of the codebase.

**TypeScript project references, one per module.** The strongest possible import boundary:
reaching past a surface would be a compile error rather than a check. Rejected for now
because it makes adding a module a build-configuration change — forty `tsconfig.json` files
and a reference graph kept in step with `dependsOn` by hand — which is exactly the per-module
manual step the module contract exists to remove. It remains the right answer if the text
rules are ever defeated in practice rather than in theory.

**Enforcement at runtime, in the Nest container.** Catches an injection that crosses a
boundary and nothing else, at the worst possible moment, and only for code paths that ran.

## Consequences

The rules read source text with regular expressions, after stripping comments. They are a
build refusing an ordinary mistake, not a sandbox: a delegate deliberately aliased through a
variable defeats the table rule, and an import assembled from string fragments defeats the
import rule. That is the same trade `scripts/check-tenancy.mjs` already makes, and it is
accepted for the same reason — the check runs on nothing, in a moment, before the tests.

Two consequences are worth knowing about because they surprised us:

- **The rules must be able to describe themselves.** A bare search for `from '…'` matched
  the sentence *"what they share comes from `'@erp/shared/ui'`"* inside a violation message,
  so the check that forbids the import failed on the file that explains it. Import matching
  is anchored to statement-initial `import`/`export` for that reason. The same trap caught
  `check-tenancy.mjs` before it, which is why both strip comments.
- **`models` had to be added to the manifest.** "A module may not query another module's
  tables" has no meaning until every table has exactly one owner, so `npm run check:modules`
  now refuses a model in `schema.prisma` that no manifest claims — the same bargain
  `company-owned.ts` strikes with tenancy, for the same reason.

`platform/list` and `platform/validation` are platform rather than module code and are
importable by any module through their entry points, which ticket 04 flagged and this
settles. `src/http` and `src/prisma` are flat areas with no barrel and are importable by
file; when either grows an `index.ts`, the entry-point rule applies to it too.
