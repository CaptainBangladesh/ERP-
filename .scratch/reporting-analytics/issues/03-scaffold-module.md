# 03 — Scaffold the Reporting module

Type: task
Blocked by: 01, 02

## Question

Once tier (01) and phase-1 metrics (02) are decided, generate the module via
`npm run new:module` with the resolved tier and wire its `dependsOn`/event-consumption to
Inventory per foundation ticket 15's mechanism (see this map's Notes — treated as an external
prerequisite). Confirm ticket 15 has actually landed before wiring the event-consumption side;
if it hasn't, record that as the blocker here rather than working around it with a full service
dependency that would drag Reporting's tier to Inventory's.

Answer should record: the module name, its manifest as generated, and which Inventory
events/service methods it actually consumes.
