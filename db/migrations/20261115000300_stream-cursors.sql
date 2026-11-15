-- stream-cursors: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED by E-STREAM S3 (source only): the restart owner applies it
-- with the build (R110: one build), AFTER 20261114004400_stream-cursor.sql (whose three route columns this file moves and drops).
-- Concept `.starciwork/concepts/agent-data.md` rules 5, 8, 9 (owner 2026-11-15): ONE cursor table for every engine stream, per (CONSUMER
-- AGENT, STREAM, SUBJECT): `lines` (the lines of a route; subject = the route) and every record type declared append-only (subject = the
-- type's declared subject value). The consumer is the agent (the consumer-group model): a second agent reading the same subject keeps its own
-- position. `consumed_seq` = the newest item a step of the agent read and then ENDED; before that end the read is PENDING (`read_seq` +
-- `read_by`, the read's call key `<run>:<step>:...`), folded by the end of that step.
-- Data move: a route's old cursor (`customer_routes.consumed_seq`) becomes the cursor of EVERY agent that has a run keyed on that route
-- (agent_runs.subject_kind = 'routeId'), so no agent re-reads lines it already handled; a pending read (`read_seq` / `read_by`) moves with
-- the same agents (the step that made it folds it at its end). Then the three route columns and their index are DROPPED (no legacy).
-- Code without this file: every stream read fails on the missing table. This file without the code: the old reader fails on the dropped
-- columns; they ship together. Expected rows: one per (route, agent with a run on it) that had a cursor.
-- complete: apply.
CREATE TABLE IF NOT EXISTS public.stream_cursors (
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    stream text NOT NULL,
    subject text NOT NULL,
    consumed_seq bigint,
    read_seq bigint,
    read_by text,
    PRIMARY KEY (workspace_id, agent_id, stream, subject),
    CONSTRAINT stream_cursors_stream_check CHECK (char_length(stream) BETWEEN 1 AND 120),
    CONSTRAINT stream_cursors_subject_check CHECK (char_length(subject) BETWEEN 1 AND 200),
    CONSTRAINT stream_cursors_read_check
        CHECK (((read_seq IS NULL) = (read_by IS NULL)) AND (read_by IS NULL OR char_length(read_by) BETWEEN 1 AND 400))
);

-- The pending reads of a workspace by their call key (the step end finds its own by the key's `<run>:<step>:` prefix).
CREATE INDEX IF NOT EXISTS stream_cursors_read_by ON public.stream_cursors USING btree (workspace_id, read_by text_pattern_ops)
    WHERE read_by IS NOT NULL;
-- A merge joins every consumer's cursor on one subject (a contact id) into another.
CREATE INDEX IF NOT EXISTS stream_cursors_subject ON public.stream_cursors USING btree (workspace_id, subject);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stream_cursors TO app_be;

INSERT INTO public.stream_cursors (workspace_id, agent_id, stream, subject, consumed_seq, read_seq, read_by)
SELECT DISTINCT route.workspace_id, run.agent_id, 'lines', route.id::text, route.consumed_seq, route.read_seq, route.read_by
FROM public.customer_routes route
JOIN public.agent_runs run
    ON run.workspace_id = route.workspace_id AND run.subject_kind = 'routeId' AND run.subject_id::text = route.id::text
WHERE route.consumed_seq IS NOT NULL OR route.read_seq IS NOT NULL
ON CONFLICT (workspace_id, agent_id, stream, subject) DO NOTHING;

DROP INDEX IF EXISTS public.customer_routes_read_by;
ALTER TABLE public.customer_routes DROP CONSTRAINT IF EXISTS customer_routes_read_check;
ALTER TABLE public.customer_routes DROP COLUMN IF EXISTS consumed_seq;
ALTER TABLE public.customer_routes DROP COLUMN IF EXISTS read_seq;
ALTER TABLE public.customer_routes DROP COLUMN IF EXISTS read_by;
