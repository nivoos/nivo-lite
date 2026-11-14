-- cells-schema: forward-only; immutable once on origin/main. WRITTEN, NOT APPLIED to any stack database (CELLS-PLAN 2.1, 2.2: phase 0 of the NIVO V2 cells kernel).
-- The schema `cells` is the home of the stored, versioned building blocks of V2 (cells and graphs). It is a SECOND schema beside `public` (precedent: be_access): no
-- `public` table or function changes, so nothing that runs today can read or break on it. The app role (app_be, which the cli seed also uses) may use the schema; the
-- grants on each table come with the migration that creates it, and none of them includes DELETE: nothing in `cells` is ever hard-deleted (soft delete only).
-- The three guard functions below are the DATABASE side of the immutability rule: a published version is never edited, whatever code path writes it.
-- Code without this file: the cells entities map tables that do not exist (a read fails, nothing else). This file without the code: harmless.
CREATE SCHEMA IF NOT EXISTS cells;
GRANT USAGE ON SCHEMA cells TO app_be;

-- A row of cells.* is never hard-deleted (CELLS-PLAN 2.1 "Soft delete"): a delete, row or truncate, is refused whoever issues it.
CREATE OR REPLACE FUNCTION cells.refuse_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'CELLS_ROW_KEPT: % in cells is soft-deleted (deleted_at), never removed', TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

-- A table whose rows never change except in the named columns (the trigger arguments; none given: TG_ARGV is NULL, hence the coalesce), e.g. cells.sources (none) and cells.packages (deleted_at).
CREATE OR REPLACE FUNCTION cells.refuse_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (to_jsonb(NEW) - coalesce(TG_ARGV, '{}'::text[])) <> (to_jsonb(OLD) - coalesce(TG_ARGV, '{}'::text[])) THEN
        RAISE EXCEPTION 'CELLS_VERSION_IMMUTABLE: a row of cells.% never changes (only %)', TG_TABLE_NAME, array_to_string(TG_ARGV, ', ')
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- A versioned row (cells.definitions, cells.graphs): a `draft` row may still change; once `approved` it changes only in the columns named as the trigger
-- arguments (deleted_at, updated_at) and its review_state may only move approved -> retired (retired is final). Every other column is frozen.
CREATE OR REPLACE FUNCTION cells.refuse_published_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.review_state = 'draft' THEN
        RETURN NEW;
    END IF;
    IF (to_jsonb(NEW) - coalesce(TG_ARGV, '{}'::text[]) - 'review_state') <> (to_jsonb(OLD) - coalesce(TG_ARGV, '{}'::text[]) - 'review_state') THEN
        RAISE EXCEPTION 'CELLS_VERSION_IMMUTABLE: a published row of cells.% never changes (bump the version)', TG_TABLE_NAME
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.review_state <> OLD.review_state AND NOT (OLD.review_state = 'approved' AND NEW.review_state = 'retired') THEN
        RAISE EXCEPTION 'CELLS_VERSION_IMMUTABLE: a published row of cells.% moves only approved -> retired', TG_TABLE_NAME
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- Trigger functions are fired by the table trigger, which does not check EXECUTE; closed to every other role like the shared set_updated_at.
REVOKE EXECUTE ON FUNCTION cells.refuse_delete() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cells.refuse_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cells.refuse_published_change() FROM PUBLIC;
