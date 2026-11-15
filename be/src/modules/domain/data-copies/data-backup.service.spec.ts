import { Test } from "@nestjs/testing"
import type { MemoryDriver } from "@modules/integrations/seed"
import { QueueError, classifyFailure } from "@modules/platform/queue"
import {
    NIVO_SET,
    changeRecord,
    copyWorld,
    downUntilUp,
    dyingAfterWrite,
    jobOf,
    memoryDriver,
} from "@tests/fixtures/builders/data-copies.builder"
import { DataBackupService } from "./data-backup.service"
import type { DataSetDeclaration } from "./data-copies.contracts"

const PAYLOAD = { setId: "nivo-lite", slot: 20_000 }

/** A matcher for a text that contains a part: typed `unknown` so it flows into any slot of an expected object. */
const text = (part: string): unknown => expect.stringContaining(part)

const build = async (drivers: ReadonlyArray<MemoryDriver>, sets: ReadonlyArray<DataSetDeclaration> = [NIVO_SET]) => {
    const world = copyWorld(drivers, sets)
    const moduleRef = await Test.createTestingModule({ providers: [DataBackupService, ...world.providers] }).compile()
    return { service: moduleRef.get(DataBackupService), ...world }
}

describe("DataBackupService: the first run writes one copy per driver", () => {
    it("exports the stores once and every driver holds that one export; the result says when, counts, digest and drivers", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const s3 = memoryDriver({ id: "s3-copy", kind: "s3" })
        const t = await build([git, s3])

        const result = await t.service.run(jobOf(PAYLOAD))

        expect(result).toMatchObject({
            setId: "nivo-lite",
            outcome: "written",
            at: "2026-11-14T10:00:00.000Z",
            drivers: ["git-copy", "s3-copy"],
            warnings: [],
        })
        expect(result.counts).toEqual([
            { store: "database-all", set: "agents", items: 1 },
            { store: "database-all", set: "contacts", items: 2 },
            { store: "storage-all", set: "files", items: 1 },
        ])
        const copies = [await git.list(), await s3.list()]
        expect(copies.map((list) => list.length)).toEqual([1, 1])
        expect(copies.map((list) => list[0]?.exportDigest)).toEqual([result.exportDigest, result.exportDigest])
        expect(t.spools).toHaveLength(1)
    })

    it("seals to the declared recipients and writes a seed-backup manifest named for the set", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const write = jest.spyOn(git, "write")
        const t = await build([git, memoryDriver({ id: "s3-copy", kind: "s3" })])

        await t.service.run(jobOf(PAYLOAD))

        expect(write).toHaveBeenCalledTimes(1)
        const [source, context] = write.mock.calls[0] ?? []
        expect(context).toEqual({ recipients: ["age1recipient"], dryRun: false })
        expect(source?.manifest).toMatchObject({ format: "nivo-lite-seed-backup@1", purpose: "seed-backup" })
    })
})

describe("DataBackupService: nothing changed means nothing written", () => {
    it("a second run over the same data is `unchanged`: no driver is written and no copy is added", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const s3 = memoryDriver({ id: "s3-copy", kind: "s3" })
        const t = await build([git, s3])
        await t.service.run(jobOf(PAYLOAD, "job-1"))
        const writeGit = jest.spyOn(git, "write")
        const writeS3 = jest.spyOn(s3, "write")

        const second = await t.service.run(jobOf({ setId: "nivo-lite", slot: 20_001 }, "job-2"))

        expect(second.outcome).toBe("unchanged")
        expect(writeGit).not.toHaveBeenCalled()
        expect(writeS3).not.toHaveBeenCalled()
        expect([(await git.list()).length, (await s3.list()).length]).toEqual([1, 1])
        expect(t.logger.info).toHaveBeenCalledWith(
            "data.backup.unchanged",
            expect.objectContaining({ setId: "nivo-lite", outcome: "unchanged" }),
        )
    })

    it("a change of the data is one write per driver: each driver then keeps two copies, the newest with the new digest", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const s3 = memoryDriver({ id: "s3-copy", kind: "s3" })
        const t = await build([git, s3])
        const first = await t.service.run(jobOf(PAYLOAD, "job-1"))
        await changeRecord(t.stores.database, "contacts", "cy@example.test", { name: "Cy" })

        const second = await t.service.run(jobOf({ setId: "nivo-lite", slot: 20_001 }, "job-2"))

        expect(second.outcome).toBe("written")
        expect(second.exportDigest).not.toBe(first.exportDigest)
        for (const driver of [git, s3]) {
            const copies = await driver.list()
            expect(copies).toHaveLength(2)
            expect(copies[0]?.exportDigest).toBe(second.exportDigest)
        }
    })

    it("a driver that missed the last export (an earlier partial run) is written even though the other driver holds it", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const late = downUntilUp(memoryDriver({ id: "s3-copy", kind: "s3" }))
        const t = await build([git, late.driver])
        await expect(t.service.run(jobOf(PAYLOAD, "job-1"))).rejects.toBeInstanceOf(QueueError)
        late.up()

        const second = await t.service.run(jobOf({ setId: "nivo-lite", slot: 20_001 }, "job-2"))

        expect(second.outcome).toBe("written")
        expect([(await git.list()).length, (await late.driver.list()).length]).toEqual([1, 1])
    })
})

describe("DataBackupService: a job killed in the middle of a write resumes without a duplicate copy", () => {
    it("the first driver stores its copy and loses the answer: the retry finds every driver holding the export and writes nothing more", async () => {
        const git = dyingAfterWrite(memoryDriver({ id: "git-copy" }))
        const s3 = memoryDriver({ id: "s3-copy", kind: "s3" })
        const t = await build([git, s3])

        const first = t.service.run(jobOf(PAYLOAD))
        await expect(first).rejects.toBeInstanceOf(QueueError)
        await expect(first).rejects.toMatchObject({ params: { failureClass: "transient" } })
        expect((await git.list()).length).toBe(1)

        const second = await t.service.run(jobOf(PAYLOAD))

        expect(second.outcome).toBe("unchanged")
        expect([(await git.list()).length, (await s3.list()).length]).toEqual([1, 1])
    })

    it("the second driver is down on the first run: the retry of the same job answers the first driver from the ledger and writes the second once", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const s3 = downUntilUp(memoryDriver({ id: "s3-copy", kind: "s3" }))
        const t = await build([git, s3.driver])
        await expect(t.service.run(jobOf(PAYLOAD))).rejects.toMatchObject({ params: { failureClass: "transient" } })
        const writeGit = jest.spyOn(git, "write")
        s3.up()

        const second = await t.service.run(jobOf(PAYLOAD))

        expect(second.outcome).toBe("written")
        expect(second.drivers).toEqual(["git-copy", "s3-copy"])
        expect(writeGit).not.toHaveBeenCalled()
        expect(t.ledger.rows.get("job-1:data.copy-write:git-copy")?.acts).toBe(1)
        expect([(await git.list()).length, (await s3.driver.list()).length]).toEqual([1, 1])
    })
})

describe("DataBackupService: failure classes", () => {
    it("a copy over the driver's cap is refused with the configuration class: no retry, the reason names the driver and the code", async () => {
        const git = memoryDriver({ id: "git-copy", limits: { maxCopyBytes: 10 } })
        const t = await build([git, memoryDriver({ id: "s3-copy", kind: "s3" })])

        const failure = await t.service.run(jobOf(PAYLOAD)).catch((cause: unknown) => cause)

        expect(failure).toBeInstanceOf(QueueError)
        expect(classifyFailure(failure)).toBe("config")
        expect(failure).toMatchObject({
            params: { failureClass: "config", reason: text("git-copy refused with DATA_GIT_CAP_EXCEEDED") },
        })
        expect((await git.list()).length).toBe(0)
    })

    it("one driver failing for good is a partial run: the job ends with one failure naming driver and code, and the other copy is kept", async () => {
        const git = memoryDriver({
            id: "git-copy",
            fail: { on: "write", code: "DATA_SEAL_FAILED", retry: "configuration" },
        })
        const s3 = memoryDriver({ id: "s3-copy", kind: "s3" })
        const t = await build([git, s3])

        const failure = await t.service.run(jobOf(PAYLOAD)).catch((cause: unknown) => cause)

        expect(classifyFailure(failure)).toBe("config")
        expect(failure).toMatchObject({
            params: { reason: text("driver git-copy refused with DATA_SEAL_FAILED (copies kept by s3-copy)") },
        })
        expect([(await git.list()).length, (await s3.list()).length]).toEqual([0, 1])
    })

    it("a driver that is unreachable is transient: the runner retries it on the ladder", async () => {
        const git = memoryDriver({
            id: "git-copy",
            fail: { on: "write", code: "DATA_DRIVER_UNAVAILABLE", retry: "transient" },
        })
        const t = await build([git, memoryDriver({ id: "s3-copy", kind: "s3" })])

        const failure = await t.service.run(jobOf(PAYLOAD)).catch((cause: unknown) => cause)

        expect(classifyFailure(failure)).toBe("transient")
        expect(failure).toMatchObject({
            params: { reason: text("driver git-copy failed with DATA_DRIVER_UNAVAILABLE") },
        })
    })

    it("a data set nothing declares is refused as input, a driver nothing provides as a missing setting", async () => {
        const t = await build([memoryDriver({ id: "git-copy" })])

        await expect(t.service.run(jobOf({ setId: "nope", slot: 1 }))).rejects.toMatchObject({
            params: { failureClass: "input" },
        })
        await expect(t.service.run(jobOf(PAYLOAD))).rejects.toMatchObject({
            params: { failureClass: "config", reason: text("s3-copy") },
        })
    })

    it("a failure that is not a data refusal keeps the class the one classifier gives it (never made transient by a guess) and its cause", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const s3 = memoryDriver({ id: "s3-copy", kind: "s3" })
        const t = await build([git, s3])
        const broken = new TypeError("a bug in a driver")
        jest.spyOn(git, "write").mockRejectedValue(broken)

        const failure = await t.service.run(jobOf(PAYLOAD)).catch((cause: unknown) => cause)

        expect(failure).toMatchObject({
            cause: broken,
            params: {
                failureClass: "code",
                reason: text("driver git-copy failed unexpectedly (copies kept by s3-copy)"),
            },
        })
        expect(classifyFailure(failure)).toBe("code")
    })
})

describe("DataBackupService: a store that cannot be read writes nothing", () => {
    /** A run whose database store fails to read with `cause`. */
    const runWith = async (cause: Error): Promise<{ readonly failure: unknown; readonly copies: number }> => {
        const git = memoryDriver({ id: "git-copy" })
        const t = await build([git], [{ ...NIVO_SET, drivers: ["git-copy"] }])
        const failing = { next: jest.fn().mockRejectedValue(cause) }
        jest.spyOn(t.stores.database, "export").mockReturnValue({ [Symbol.asyncIterator]: () => failing })
        const failure = await t.service.run(jobOf(PAYLOAD)).catch((error: unknown) => error)
        return { failure, copies: (await git.list()).length }
    }

    it("is transient when its own cause is the network", async () => {
        const run = await runWith(Object.assign(new Error("reset"), { code: "ECONNRESET" }))

        expect(classifyFailure(run.failure)).toBe("transient")
        expect(run.copies).toBe(0)
    })

    it("is a configuration stop when its cause is anything else", async () => {
        const run = await runWith(new Error("no such table"))

        expect(classifyFailure(run.failure)).toBe("config")
        expect(run.copies).toBe(0)
    })
})

describe("DataBackupService: a copy near its cap warns without failing", () => {
    it("the receipt's DATA_GIT_CAP_NEAR is in the result and the log, and the backup is written", async () => {
        const git = memoryDriver({ id: "git-copy", limits: { warnCopyBytes: 1 } })
        const t = await build([git, memoryDriver({ id: "s3-copy", kind: "s3" })])

        const result = await t.service.run(jobOf(PAYLOAD))

        expect(result.outcome).toBe("written")
        expect(result.warnings).toEqual([{ driver: "git-copy", code: "DATA_GIT_CAP_NEAR" }])
        expect(t.logger.warn).toHaveBeenCalledWith("data.backup.warning", {
            setId: "nivo-lite",
            driver: "git-copy",
            code: "DATA_GIT_CAP_NEAR",
        })
        expect(t.logger.info).toHaveBeenCalledWith("data.backup.done", expect.objectContaining({ setId: "nivo-lite" }))
    })
})
