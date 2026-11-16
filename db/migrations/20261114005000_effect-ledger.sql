-- effect-ledger: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED by P1-EFFECTS (source only): the restart owner applies it with
-- the code that reads and writes it. Idempotent (every statement may run twice).
-- THE EFFECT LEDGER (rule J-5). Every act outside NIVO's database (a provider request, a mail, a paid model call, a vector write) is made through
-- the one effects piece: a row keyed `<jobId>:<effect>[:<part>]` is committed as an INTENT before the act and settled `done` after it, so a
-- process that dies between the two leaves a row the next run reads as a lost act and settles as the effect declares (act again, confirm by a
-- read, or `unknown` for a person). `result` keeps what a later call needs of the answer as {"kept": value}; null = nothing kept.
-- Code without this file: every effect call fails on the missing table. This file without the code: harmless (nothing reads or writes it).
CREATE TABLE IF NOT EXISTS public.effect_ledger (
    key        text PRIMARY KEY,
    name       text NOT NULL,
    state      text NOT NULL CHECK (state IN ('intent', 'done', 'unknown')),
    result     jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz
);

-- The shared updated_at trigger of every AbstractEntity table (public.set_updated_at, baseline).
DROP TRIGGER IF EXISTS effect_ledger_set_updated_at ON public.effect_ledger;
CREATE TRIGGER effect_ledger_set_updated_at BEFORE UPDATE ON public.effect_ledger FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Retention reads the oldest settled rows first.
CREATE INDEX IF NOT EXISTS effect_ledger_created_at ON public.effect_ledger USING btree (created_at);
