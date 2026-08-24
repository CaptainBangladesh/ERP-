# 05 — Workflow automation rules

**What to build:** A sales manager configures a no-code rule via a structured form — a trigger
(a Deal entering a named Stage, or a Lead's status changing to a named value) paired with an
action (notify a user, update a non-stage/status field, or create a follow-up task) — and sees it
actually fire the next time a matching Deal/Lead change happens, evaluated synchronously and
best-effort inside the same request that caused the trigger. Multiple matching rules all fire; a
disabled rule never does. Deliberately no time-based triggers in this ticket (see the spec's Out
of Scope — this platform has no scheduler yet). Full trigger/action catalog and config shapes are
in [the spec](../spec.md)'s "Workflow automation" section.

The `create_task` action produces an `Activity` row; if ticket 04 hasn't landed yet, implement it
as a clearly-marked stub (validated config, no-op execution) so the rest of this ticket — rule
CRUD, the other two actions, and trigger evaluation — ships without waiting on it, and finish the
real write once ticket 04's `Activity` model exists.

**Blocked by:** 02, 03

- [ ] `WorkflowRule` model + migration: name, triggerType, triggerConfig, actionType,
      actionConfig, enabled.
- [ ] Rule CRUD, permissioned under `crm:workflow-rules:*`.
- [ ] Evaluation hook wired into the Deal stage-change and Lead status-change endpoints, firing
      all matching enabled rules after the triggering write commits (non-transactional,
      best-effort — a failing action doesn't undo the triggering change).
- [ ] `notify_user` action writes an in-app notification record the named user sees; no
      email/push delivery.
- [ ] `update_field` action refuses targeting `Deal.stageId` or `Lead.status`.
- [ ] `create_task` action creates (or, if 11 hasn't landed, stubs) a task-type Activity.
- [ ] Structured-form rule configuration screen (trigger dropdown + condition + action dropdown +
      action fields) — no visual/drag builder in this ticket.
- [ ] HTTP integration tests covering: a rule firing on a matching change and not on a
      non-matching one, multiple rules matching one trigger all firing, a disabled rule never
      firing, `update_field`'s stageId/status refusal, and tenant isolation.
