-- grant-records-seq-app-engine: forward-only; immutable once on origin/main. Written by RESTART-R9 (mechanical repair, the R8 grant precedent
-- 20261114013100). `20261115000100_records-seq.sql` gave `public.records.seq` the default `nextval('public.records_seq')` and granted the
-- sequence to `app_be`, but `public.records` is written by the entity engine's role `app_engine` (baseline: `records`, `record_links`,
-- `entity_sequences` are granted to app_engine, not app_be), so every record insert failed on dev with "permission denied for sequence
-- records_seq" (ENTITY_ENGINE_SCOPE_VIOLATION on `nivo.tool.record.create`). The writer of the table draws the numbers. Idempotent.
-- complete: apply.
GRANT SELECT, USAGE ON SEQUENCE public.records_seq TO app_engine;
