-- job-progress: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED by the REFACTOR lane (P1-PROGRESS): the restart owner applies it.
-- The optional progress of a job (`defineJob({ progress })`): the job row records the topic its state changes and step progress go to,
-- and the last step report (done of total, a label KEY, its time), so the stream is a VIEW of the row: a subscriber that connects late
-- reads these columns first, and a crash loses nothing the stream showed. A job that declares no progress leaves every column null.
-- `progress_retry_at` is when a failed job's retry runs again (the runner's scheduled time): a late subscriber's snapshot of a job
-- waiting for its retry carries it. The partial index `jobs_progress_recent` serves the snapshot of a whole workspace (the rows changed
-- in the last day). Both belong to this same file because it is not applied anywhere yet.
-- Additive only: no rewrite of existing rows, no default, safe while the old build runs.

ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS progress_topic text,
    ADD COLUMN IF NOT EXISTS progress_done integer,
    ADD COLUMN IF NOT EXISTS progress_total integer,
    ADD COLUMN IF NOT EXISTS progress_label text,
    ADD COLUMN IF NOT EXISTS progress_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS progress_retry_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS jobs_progress_topic ON public.jobs USING btree (progress_topic, kind, updated_at DESC)
    WHERE progress_topic IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_progress_recent ON public.jobs USING btree (updated_at DESC)
    WHERE progress_topic IS NOT NULL;
