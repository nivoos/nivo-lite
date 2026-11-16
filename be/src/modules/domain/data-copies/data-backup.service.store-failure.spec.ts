import { Test } from "@nestjs/testing"
import { DATA_STORES, DataStoresError, DataStoresErrorCode } from "@modules/domain/data-stores"
import { classifyFailure } from "@modules/platform/queue"
import { copyWorld, jobOf, memoryDriver } from "@tests/fixtures/builders/data-copies.builder"
import { DataBackupService } from "./data-backup.service"
import { DataCopiesLogEvent } from "./data-copies.log-events"

/** What the data package names a coded error by: its class, then its code (never its message). */
const CAUSE = `DataStoresError ${DataStoresErrorCode.ScopeUnknown}`
const PAYLOAD = { setId: "nivo-lite", slot: 20_000 }

/** The world of the backup with its database store replaced by one that refuses to read, like a store whose read the database denies. */
const build = async () => {
    const world = copyWorld([memoryDriver({ id: "git-copy" }), memoryDriver({ id: "s3-copy", kind: "s3" })])
    const failing = {
        ...world.stores.database,
        export: async function* () {
            await Promise.resolve()
            yield* []
            throw new DataStoresError({ code: DataStoresErrorCode.ScopeUnknown })
        },
    }
    const providers = [...world.providers, { provide: DATA_STORES, useValue: [failing, world.stores.storage] }]
    const moduleRef = await Test.createTestingModule({ providers: [DataBackupService, ...providers] }).compile()
    return { service: moduleRef.get(DataBackupService), logger: world.logger }
}

describe("DataBackupService: a store that fails names itself in the job failure and in the log", () => {
    it("fails the job with the store and the cause (never a message), logs the refusal once with the job and the set,", async () => {
        const t = await build()

        const failure: unknown = await t.service.run(jobOf(PAYLOAD)).then(
            () => null,
            (cause: unknown) => cause,
        )

        expect(failure).toMatchObject({
            params: {
                failureClass: "config",
                store: "database-all",
                cause: CAUSE,
                reason: `DATA_STORE_FAILED store=database-all cause=${CAUSE}`,
            },
        })
        expect(classifyFailure(failure)).toBe("config")
        const logged = jest.mocked(t.logger.error).mock.calls
        expect(logged).toHaveLength(1)
        expect(logged[0]?.[0]).toBe(DataCopiesLogEvent.BackupRefused)
        expect(logged[0]?.[2]).toEqual({
            jobId: "job-1",
            setId: "nivo-lite",
            code: "DATA_STORE_FAILED",
            retry: "configuration",
            store: "database-all",
            cause: CAUSE,
        })
    })
})
