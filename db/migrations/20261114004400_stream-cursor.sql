-- stream-cursor: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED by QB-P5 (source only): the restart owner applies it with
-- the code that reads and writes it. Idempotent (every statement may run twice).
-- THE STREAM CURSOR (rule QB-P5 C-4, owner defect O-R6-2). A route's lines (public.customer_messages) are an engine STREAM; the engine keeps,
-- per route, the position a run CONSUMED: `consumed_seq` = the insertion order (`customer_messages.seq`) of the newest person line a step of
-- a run READ and then ENDED (done, or passed over / ended unsuccessful; never a stop, which runs the step again). Before that end the read is
-- PENDING on the route: `read_seq` (the newest person line the read returned) and `read_by` (the read's call key `<run>:<step>:...`); the end
-- of the step whose key it names folds it into the cursor (GREATEST) and clears it; a later read by another step replaces it. A reader of
-- the stream takes the person's lines AFTER the cursor; no cursor (null: no run consumed the route yet) = "after the shop's last line".
-- Code without this file: every stream read fails on the missing columns. This file without the code: harmless (nothing reads or writes them).
ALTER TABLE public.customer_routes ADD COLUMN IF NOT EXISTS consumed_seq bigint;
ALTER TABLE public.customer_routes ADD COLUMN IF NOT EXISTS read_seq bigint;
ALTER TABLE public.customer_routes ADD COLUMN IF NOT EXISTS read_by text;

ALTER TABLE public.customer_routes DROP CONSTRAINT IF EXISTS customer_routes_read_check;
ALTER TABLE public.customer_routes ADD CONSTRAINT customer_routes_read_check
    CHECK (((read_seq IS NULL) = (read_by IS NULL)) AND (read_by IS NULL OR char_length(read_by) BETWEEN 1 AND 400));

-- The pending reads of a workspace by their call key (the step end finds its own by the key's `<run>:<step>:` prefix): only routes that hold
-- one are in it.
CREATE INDEX IF NOT EXISTS customer_routes_read_by ON public.customer_routes USING btree (workspace_id, read_by text_pattern_ops)
    WHERE read_by IS NOT NULL;
