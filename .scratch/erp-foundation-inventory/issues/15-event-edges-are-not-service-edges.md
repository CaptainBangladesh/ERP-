# 15 — An event edge is not a service edge

**What to build:** A way for a module to listen to another without depending on it. Today
`dependsOn` is one declaration doing two jobs — "I may inject this module's public service" and
"I may hear this module's events" — and a sink needs only the second. Accounting is the roadmap
module that makes the difference visible: it listens to Inventory, Sales, Purchase, Payroll and
Manufacturing, injects nothing from any of them, and is depended on by none.

Making it declare all of those as dependencies costs three things it should not:

- **Removing any emitter takes the sink down.** The deletion test — excluding a business module
  leaves the application building — holds for every module below the one removed, and fails for
  a listener. An event nobody emits is simply never heard; that should not be a failed assembly.
- **Listening drags the emitter's tier along.** `checkTier` refuses a Core module depending on an
  Enterprise one, so Accounting cannot be Core while it hears `hrm.pay-run.calculated`. A
  Core-tier company running Inventory, Sales and Purchase — every one of them emitting exactly
  what a ledger wants — cannot have a general ledger, because payroll is an upsell.
- **It is the wrong shape to copy thirty-nine times.** Every later listener inherits it, and the
  fan-in gives the sink the largest declared dependency list in the system while its real
  coupling is the smallest.

This is the foundation audit's first finding. It is a contract change, so it wants its own tests
and its own review rather than riding along inside the module that trips over it.

**Blocked by:** 14 — Foundation audit against the module roadmap

**Blocks:** any Accounting module. Nothing else on the roadmap.

**Status:** ready-for-agent

- [ ] The manifest distinguishes a service dependency from an event subscription
- [ ] A module may consume an event without declaring the emitter as a dependency
- [ ] A consumed event whose emitter is absent leaves the application assembling
- [ ] A consumed event whose emitter is present is still checked against what that module emits
- [ ] Consuming an event does not constrain the consumer's tier
- [ ] An event subscription does not grant permission to import the emitting module
- [ ] The import rule still refuses a module importing another it has no service dependency on
- [ ] A module that emits an event it never declared fails the build
- [ ] A module that listens for an event it never declared fails the build
- [ ] The refusal messages name both modules and the permitted alternative
- [ ] `roadmap-audit.spec.ts`'s two finding assertions are rewritten to assert the new behaviour
- [ ] The generator's manifest template carries the new declaration
- [ ] `docs/modules.md` and ADR 0001 record how the two edges differ

## Comments

**2026-08-04 — where the two refusals live, and what the tests currently say.**

`assembleModules` is the whole of it: `checkDependenciesExist` refuses an absent dependency and
`checkTier` refuses reaching up a tier, and `checkEventsAreDeclared` is what forces a consumer to
name the emitter in `dependsOn` in the first place. All three are in
`backend/src/platform/modules/assemble.ts`.

`backend/test/roadmap-audit.spec.ts` asserts today's behaviour under two tests named as findings —
"refuses to be Core while listening to an Enterprise module" and "takes the sink down with any
source removed". **Both will fail when this ticket lands, and that is the point:** they are the
specification of what has to change, written as assertions that pass today so the audit could run
them. Rewrite them rather than deleting them.

The last two criteria are the conformance pack's, not the assembler's, and they are the gap ADR
0009 records: nothing today ties `events.emits` or `events.consumes` to the code that calls
`DomainEvents.emit` or `DomainEvents.on`. A module can emit a name with a typo in it and the event
is never heard, silently, in the one seam built for a module that does not exist yet. That is the
same class of failure `permission-declared` was added for, and it belongs here because this ticket
is already changing how event edges are declared.

See ADR 0009, finding 1 — including why the two shape stubs did not catch this: both are things
other modules do not listen to, so nothing in the foundation has ever consumed an event and the
one rule governing consumption has never had a case run against it.
