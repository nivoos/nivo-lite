-- cells-seed-receipts: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED to any stack database (CELLS-PLAN 2.1, 3.3; seeds-and-data rules 9-10).
-- cells.seed_receipts: one row per applied package commit, with the report of what the apply did cell by cell. UNIQUE (package_key, commit, forced): a package
-- commit applies once, and a FORCE declared on the stack re-applies it once more. Receipts are append-only (never updated or removed); created_at is the
-- time of the apply.
-- Needs 20261115100000_cells-schema.sql.
CREATE TABLE IF NOT EXISTS cells.seed_receipts (
    id           uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    package_key  text NOT NULL,
    repository   text NOT NULL,
    commit       text NOT NULL,
    forced       boolean DEFAULT false NOT NULL,
    report       jsonb NOT NULL,
    created_at   timestamptz DEFAULT now() NOT NULL,
    updated_at   timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT seed_receipts_package_commit_forced_unique UNIQUE (package_key, commit, forced),
    CONSTRAINT seed_receipts_package_key_check CHECK (char_length(package_key) BETWEEN 1 AND 200),
    CONSTRAINT seed_receipts_report_check CHECK (jsonb_typeof(report) = 'object')
);
CREATE TRIGGER seed_receipts_refuse_change BEFORE UPDATE ON cells.seed_receipts
    FOR EACH ROW EXECUTE FUNCTION cells.refuse_change();
CREATE TRIGGER seed_receipts_refuse_delete BEFORE DELETE ON cells.seed_receipts
    FOR EACH ROW EXECUTE FUNCTION cells.refuse_delete();
CREATE TRIGGER seed_receipts_refuse_truncate BEFORE TRUNCATE ON cells.seed_receipts
    FOR EACH STATEMENT EXECUTE FUNCTION cells.refuse_delete();
GRANT SELECT, INSERT ON TABLE cells.seed_receipts TO app_be;
