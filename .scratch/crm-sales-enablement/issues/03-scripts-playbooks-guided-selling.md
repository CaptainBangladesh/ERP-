# 03 — Scripts, playbooks & guided selling

Type: grilling
Status: resolved

## Question

Build the **content-and-guidance track** end to end: the scripts/playbooks model + authoring, the
scripts surfaced **in-context on the lead**, and **guided next-best-action**. Independent of the
planning workspace — can run in parallel. Grill each part as you build it.

- **Model & authoring**
  - **Script** — spoken/guidance content (opener, discovery, objection-handling, close), distinct
    from email templates (which exist, for sending). Fields: title, body, category/type, and how
    it's keyed to usefulness (lead `status` / deal `stage` / tag). Support **merge-tags** via
    `template-tag-resolver.ts` — do not invent a second merge mechanism.
  - **Playbook** — a named play bundling an **ordered sequence of steps**, each referencing a
    script and/or instruction (`{ order, title, instruction, scriptId?, activityType? }`). Content
    only; auto-advance / time-gated sequencing is **fog** (no-scheduler gap, map Notes).
  - **Authoring** — manager-gated (`crm:playbooks:write`), company-scoped, no seed data. A lean
    authoring surface, not a big standalone library (ruled out of scope).
- **In-context on the lead** — a panel on the lead workspace showing the most-relevant scripts for
  the lead's current `status`/`stage`, rendered with lead data merged in, one-click copy. If the
  lead is on a playbook, surface the current step's script. Placement: dock on the lead workspace
  (mind `[[crm-workspace-layout-overflow]]`). Optionally log "used script X" as an Activity (feeds
  the heatmap) — decide if in-scope.
- **Guided next-best-action** — an on-request (no scheduler) recommendation on the lead workspace:
  given `status`/`stage` + playbook position + last-activity recency, propose the next step + script
  with a one-click "do it" that creates the task (ticket-01 assignee = current rep). Playbook
  progression is **manual** "mark step done" advancing the pointer, not timed auto-advance.

Resolution builds `Script`/`Playbook`(+`PlaybookStep`) models, migration, services/controllers,
the authoring UI, and the two lead-workspace surfaces (scripts panel + next-best-action prompt).
