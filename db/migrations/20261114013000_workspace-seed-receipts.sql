-- workspace-seed-receipts: forward-only; immutable once on origin/main. SEED-REPO (owner R98, R101-R104). WRITTEN, NOT APPLIED (source only):
-- the restart owner applies it with the code that reads and writes it. Idempotent (every statement may run twice).
-- THE RECEIPT OF A SEED STANDARD: a `<name>-seed-standard` repo is applied ONCE per environment by the stack's bring-up (`cli seed-standard
-- apply`, the seed step's own command); this row says it was, at which pinned commit, at which commit a FORCE declared on the stack was last
-- consumed, which workspace it made, when and what it did (`tally`: created / updated / left changed by a person / no longer in the
-- standard). A bring-up that finds the row skips the standard whole; a new pin is only reported; a declared force re-seeds once per commit.
-- The harness's own `starci_seed_receipts` is the harness's table (it receipts the seed STEP, not the workspace); this one belongs to the app.
-- Code without this file: every bring-up of a seed standard fails on the missing table. This file without the code: harmless.
-- complete: apply.
CREATE TABLE IF NOT EXISTS public.workspace_seed_receipts (
    seed_name     text NOT NULL CHECK (seed_name ~ '^[a-z0-9][a-z0-9-]{0,39}-seed-standard$'),
    environment   text NOT NULL CHECK (char_length(environment) BETWEEN 1 AND 40),
    workspace_id  uuid NOT NULL REFERENCES public.workspaces (id),
    seeded_commit text NOT NULL CHECK (seeded_commit ~ '^[0-9a-f]{40}$'),
    forced_commit text CHECK (forced_commit IS NULL OR forced_commit ~ '^[0-9a-f]{40}$'),
    applied_at    timestamptz NOT NULL DEFAULT now(),
    tally         jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (seed_name, environment)
);
