-- grant-effect-ledger-seed-receipts: forward-only; immutable once on origin/main. Written by RESTART-R8 (2026-11-14): the two tables
-- created by 20261114005000_effect-ledger.sql and 20261114013000_workspace-seed-receipts.sql carried no grant for the app role, so the
-- app (role app_be) is refused `permission denied` on its first read or write (measured: `seed-standard apply --dry` refused on
-- workspace_seed_receipts). Same grants as every app-owned table (cf. 20261114001000_provider-sandbox.sql). Idempotent.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.effect_ledger TO app_be;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_seed_receipts TO app_be;
