-- A dated Activity (a task) gains an owner, distinct from the person who logged it. This is the
-- keystone the team calendar, activity heatmap, coordination view and a rep's personal planner
-- all rest on: with an assignee, work can be handed out and every team view can group by rep.
--
-- A plain platform User id with no FK, matching `leads.assigned_to_user_id` and
-- `deals.assigned_to_user_id` — live, reassignable, and resolved to a name by the frontend.
ALTER TABLE "activities" ADD COLUMN "assigned_to_user_id" UUID;

-- Existing tasks default their assignee to whoever created them, so no open task is left
-- ownerless the day this ships. Only tasks: a call or a note is a record of something that
-- happened, not work owed, so it keeps a null assignee.
UPDATE "activities"
SET "assigned_to_user_id" = "created_by_user_id"
WHERE "type" = 'task';

-- "This rep's upcoming tasks", ordered by due date — the read the calendar and planner walk.
CREATE INDEX "activities_company_id_assigned_to_user_id_due_at_idx"
  ON "activities" ("company_id", "assigned_to_user_id", "due_at");
