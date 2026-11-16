import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { StoreAdapter } from "@starci/seed"
import type { PostgresRunner } from "@starci/seed/postgres"
import type { SeedPostgresLibrary } from "./seed.port"
import { BACKUP_EXCLUSIONS, BACKUP_SCHEMAS, DATABASE_ALL_STORE_ID, databaseAllOf } from "./seed-postgres.policy"

const SUBJECT = Symbol("seed-postgres.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { databaseAllOf } }],
    }).compile()
    return moduleRef.get<typeof import("./seed-postgres.policy")>(SUBJECT)
}

describe("the whole-database store of the deployment", () => {
    it("is built over the runner with the schemas and the excluded tables with their reasons", async () => {
        const subject = await build()
        const store = mock<StoreAdapter>()
        const library = mock<SeedPostgresLibrary>()
        library.postgresStore.mockReturnValue(store)
        const run = mock<PostgresRunner>()

        const built = subject.databaseAllOf(library, run)

        expect(built).toBe(store)
        expect(library.postgresStore).toHaveBeenCalledWith({
            id: "database-all",
            run,
            schemas: ["public", "auth"],
            exclude: BACKUP_EXCLUSIONS.map(({ table, reason }) => ({ table, reason })),
        })
    })

    it("holds the accounts with the product and leaves out only tables it can say why, each once and under a schema it holds", () => {
        expect(DATABASE_ALL_STORE_ID).toBe("database-all")
        expect(BACKUP_SCHEMAS).toEqual(["public", "auth"])
        expect(BACKUP_EXCLUSIONS.length).toBeGreaterThan(0)
        expect(new Set(BACKUP_EXCLUSIONS.map((entry) => entry.table)).size).toBe(BACKUP_EXCLUSIONS.length)
        for (const entry of BACKUP_EXCLUSIONS) {
            expect(BACKUP_SCHEMAS).toContain(entry.table.split(".")[0])
            expect(entry.reason.length).toBeGreaterThan(20)
        }
    })

    it("never excludes what is the only record of work or of a person: jobs, the outbox, checkpoints, the effect ledger, accounts and sessions", () => {
        const excluded = BACKUP_EXCLUSIONS.map((entry) => entry.table)

        for (const kept of [
            "public.job_outbox",
            "public.jobs",
            "public.agent_checkpoints",
            "public.effect_ledger",
            "public.account_data",
            "public.identity_sessions",
            "public.identity_refresh_tokens",
            "public.workspace_seed_receipts",
        ])
            expect(excluded).not.toContain(kept)
    })
})
