import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectPrimaryEntityManager, returnedRows, rowShape } from "@modules/platform/database"
import type { SeedReceipt } from "./seed-standard.policy"
import type { SeedTally } from "./set-seed.service"

const FIND_SQL = `SELECT seed_name, environment, workspace_id::text AS workspace_id, seeded_commit, forced_commit, applied_at
FROM public.workspace_seed_receipts WHERE seed_name = $1 AND environment = $2`

const RECORD_SQL = `INSERT INTO public.workspace_seed_receipts (seed_name, environment, workspace_id, seeded_commit, forced_commit, applied_at, tally)
VALUES ($1, $2, $3, $4, $5, now(), $6::jsonb)
ON CONFLICT (seed_name, environment) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, seeded_commit = EXCLUDED.seeded_commit,
    forced_commit = EXCLUDED.forced_commit, applied_at = EXCLUDED.applied_at, tally = EXCLUDED.tally`

const REMOVE_SQL = "DELETE FROM public.workspace_seed_receipts WHERE seed_name = $1 AND environment = $2"

const isReceiptRow = rowShape({
    seed_name: "string",
    environment: "string",
    workspace_id: "string",
    seeded_commit: "string",
    forced_commit: "string?",
    applied_at: "date",
})

/** What a bring-up records after it applied a standard. */
export interface SeedReceiptWrite {
    readonly name: string
    readonly environment: string
    readonly workspaceId: string
    readonly commit: string
    /** The commit a force was consumed at, or null (a first seed). */
    readonly forcedCommit: string | null
    readonly tally: SeedTally
}

@Injectable()
/**
 * The RECEIPTS of the seed standards (R102): one row per standard and environment (`public.workspace_seed_receipts`, migration
 * 20261114013000): the workspace it made, the commit it was seeded at, the commit a force was last consumed at, when, and what it did. A
 * bring-up reads it before anything else: with a receipt the standard is skipped whole.
 */
export class SeedReceiptsService {
    constructor(@InjectPrimaryEntityManager() private readonly entityManager: EntityManager) {}

    /** The receipt of a standard in an environment, or null when it was never seeded there. */
    async find(name: string, environment: string): Promise<SeedReceipt | null> {
        const raw: unknown = await this.entityManager.query(FIND_SQL, [name, environment])
        const [row] = returnedRows(raw, isReceiptRow)
        return row === undefined
            ? null
            : {
                  name: row.seed_name,
                  environment: row.environment,
                  workspaceId: row.workspace_id,
                  commit: row.seeded_commit,
                  forcedCommit: row.forced_commit,
                  appliedAt: row.applied_at.toISOString(),
              }
    }

    /** Records (or replaces) the receipt of a standard in an environment. */
    async record(receipt: SeedReceiptWrite): Promise<void> {
        await this.entityManager.query(RECORD_SQL, [
            receipt.name,
            receipt.environment,
            receipt.workspaceId,
            receipt.commit,
            receipt.forcedCommit,
            JSON.stringify(receipt.tally),
        ])
    }

    /** Drops the receipt (a reset took the workspace away: the next bring-up seeds the standard anew). */
    async remove(name: string, environment: string): Promise<void> {
        await this.entityManager.query(REMOVE_SQL, [name, environment])
    }
}
