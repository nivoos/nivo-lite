-- cells-packages-sources: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED to any stack database (CELLS-PLAN 2.1).
--   cells.packages: one row per seeded package VERSION: who authored it, where it was read from, and WHO MAY SEE it: `public` (every workspace) or `private`
--     (only workspaces whose enterprise identifier is in `enterprises`: the private plugin rule of layers rule 7). Only deleted_at ever changes.
--   cells.sources: the logic text of a cell, content-addressed by its sha256 (UNIQUE). The text is never updated and never removed (trigger).
-- Needs 20261115100000_cells-schema.sql (schema, guard functions) and public.set_updated_at (baseline).
CREATE TABLE IF NOT EXISTS cells.packages (
    id            uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    key           text NOT NULL,
    version       text NOT NULL,
    visibility    varchar NOT NULL,
    enterprises   text[] DEFAULT '{}'::text[] NOT NULL,
    author        text NOT NULL,
    repository    text NOT NULL,
    commit        text NOT NULL,
    deleted_at    timestamptz,
    created_at    timestamptz DEFAULT now() NOT NULL,
    updated_at    timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT packages_key_version_unique UNIQUE (key, version),
    CONSTRAINT packages_key_check CHECK (char_length(key) BETWEEN 1 AND 200),
    CONSTRAINT packages_version_check CHECK (char_length(version) BETWEEN 1 AND 100),
    CONSTRAINT packages_visibility_check CHECK (visibility IN ('public', 'private')),
    -- A private package names who sees it; a public one names nobody (the list would be dead text).
    CONSTRAINT packages_enterprises_check CHECK ((visibility = 'private') = (cardinality(enterprises) > 0))
);
CREATE TRIGGER packages_set_updated_at BEFORE UPDATE ON cells.packages
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER packages_refuse_change BEFORE UPDATE ON cells.packages
    FOR EACH ROW EXECUTE FUNCTION cells.refuse_change('deleted_at', 'updated_at');
CREATE TRIGGER packages_refuse_delete BEFORE DELETE ON cells.packages
    FOR EACH ROW EXECUTE FUNCTION cells.refuse_delete();
CREATE TRIGGER packages_refuse_truncate BEFORE TRUNCATE ON cells.packages
    FOR EACH STATEMENT EXECUTE FUNCTION cells.refuse_delete();
GRANT SELECT, INSERT, UPDATE ON TABLE cells.packages TO app_be;

CREATE TABLE IF NOT EXISTS cells.sources (
    id            uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    language      varchar NOT NULL,
    text          text NOT NULL,
    sha256        varchar NOT NULL,
    bytes         integer NOT NULL,
    author_kind   varchar NOT NULL,
    author_ref    text NOT NULL,
    created_at    timestamptz DEFAULT now() NOT NULL,
    updated_at    timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT sources_sha256_unique UNIQUE (sha256),
    -- The foreign key of a cell names the source by (id, sha256), so a cell cannot carry an id that points at other text than the hash it declares.
    CONSTRAINT sources_id_sha256_unique UNIQUE (id, sha256),
    CONSTRAINT sources_language_check CHECK (language IN ('js-quickjs@1')),
    CONSTRAINT sources_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT sources_bytes_check CHECK (bytes >= 0),
    CONSTRAINT sources_author_kind_check CHECK (author_kind IN ('nivo', 'package')),
    CONSTRAINT sources_author_ref_check CHECK (char_length(author_ref) BETWEEN 1 AND 300)
);
-- No column of a source ever changes (no argument): the text stays exactly what its sha256 says.
CREATE TRIGGER sources_refuse_change BEFORE UPDATE ON cells.sources
    FOR EACH ROW EXECUTE FUNCTION cells.refuse_change();
CREATE TRIGGER sources_refuse_delete BEFORE DELETE ON cells.sources
    FOR EACH ROW EXECUTE FUNCTION cells.refuse_delete();
CREATE TRIGGER sources_refuse_truncate BEFORE TRUNCATE ON cells.sources
    FOR EACH STATEMENT EXECUTE FUNCTION cells.refuse_delete();
GRANT SELECT, INSERT ON TABLE cells.sources TO app_be;
