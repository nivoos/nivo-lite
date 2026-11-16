-- workflow-stop (RUN-END, 2026-11-15): a person STOPS a workflow (status `paused`, the existing state) and chooses what happens to the
-- events that come for it while it is stopped: recorded and reported once, not run (the default), or HELD and run in order when the
-- workflow is started again. The choice and who stopped it, when, are kept on the workflow. Expand only: three new nullable / defaulted
-- columns, nothing existing changes; old code ignores them. Forward-only; immutable once on origin/main.
-- complete: apply.
ALTER TABLE public.agent_workflows
    ADD COLUMN stopped_holds_events boolean DEFAULT false NOT NULL,
    ADD COLUMN stopped_at timestamptz,
    ADD COLUMN stopped_by uuid;
