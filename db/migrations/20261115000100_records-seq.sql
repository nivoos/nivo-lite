-- records-seq: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED by E-STREAM S4 (source only): the restart owner applies it
-- with the build (R110: one build). Concept `.starciwork/concepts/agent-data.md` rules 5 and 12: the records of a type declared `append`
-- are an engine STREAM ordered by a sequence number, like `customer_messages.seq` for the lines of a route. Every record written after this
-- file carries `seq` from ONE sequence of the whole table (`public.records_seq`); the engine takes the stream subject's transaction lock
-- before the insert, so within a subject `seq` order is commit order. Nothing reads `seq` yet (the consuming read is S3).
-- Expand only and cheap: the column is added NULLABLE with no default (no rewrite of the partitioned table, existing rows keep null), the
-- default is set AFTER the add (only new rows draw a number). A partition created later inherits the column and its default.
-- Code without this file: harmless (nothing writes or reads `seq`). This file without the code: harmless (every insert draws a number).
-- complete: apply.
CREATE SEQUENCE IF NOT EXISTS public.records_seq AS bigint;
ALTER TABLE public.records ADD COLUMN IF NOT EXISTS seq bigint;
ALTER TABLE public.records ALTER COLUMN seq SET DEFAULT nextval('public.records_seq');
ALTER SEQUENCE public.records_seq OWNED BY public.records.seq;
-- The app role inserts records, so it draws numbers (same grant as every app-owned sequence of the baseline).
GRANT SELECT, USAGE ON SEQUENCE public.records_seq TO app_be;
