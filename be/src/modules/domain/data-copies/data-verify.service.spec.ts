import { Test } from "@nestjs/testing"
import type { DriverAdapter } from "@modules/integrations/seed"
import { QueueError, classifyFailure } from "@modules/platform/queue"
import {
    NIVO_SET,
    changeRecord,
    copyWorld,
    jobOf,
    memoryDriver,
    writeCopy,
} from "@tests/fixtures/builders/data-copies.builder"
import type { DataSetDeclaration } from "./data-copies.contracts"
import { DataVerifyService } from "./data-verify.service"

const TICK = { tick: true }

/** A matcher for a text that contains a part: typed `unknown` so it flows into any slot of an expected object. */
const text = (part: string): unknown => expect.stringContaining(part)

const build = async (drivers: ReadonlyArray<DriverAdapter>, sets: ReadonlyArray<DataSetDeclaration> = [NIVO_SET]) => {
    const world = copyWorld(drivers, sets)
    const moduleRef = await Test.createTestingModule({ providers: [DataVerifyService, ...world.providers] }).compile()
    return { service: moduleRef.get(DataVerifyService), ...world }
}

describe("DataVerifyService: healthy copies", () => {
    it("verifies the newest copy of each driver, restores it into scratch and finds the export equal to the manifest", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const s3 = memoryDriver({ id: "s3-copy", kind: "s3" })
        const t = await build([git, s3])
        await writeCopy(git, t.stores)
        await writeCopy(s3, t.stores)

        const receipts = await t.service.run(jobOf(TICK))

        expect(receipts).toHaveLength(1)
        expect(receipts[0]).toMatchObject({
            setId: "nivo-lite",
            at: "2026-11-14T10:00:00.000Z",
            healthy: true,
            findings: [],
        })
        expect(receipts[0]?.copies.map((copy) => [copy.driver, copy.healthy])).toEqual([
            ["git-copy", true],
            ["s3-copy", true],
        ])
        expect(receipts[0]?.copies[0]?.checks.map((check) => check.name)).toContain("restore")
        expect(t.logger.info).toHaveBeenCalledWith(
            "data.verify.done",
            expect.objectContaining({ setId: "nivo-lite", healthy: true }),
        )
    })

    it("restores only into isolated scratch stores: the live stores are never written, and every spool is disposed of", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const s3 = memoryDriver({ id: "s3-copy", kind: "s3" })
        const t = await build([git, s3])
        await writeCopy(git, t.stores)
        await writeCopy(s3, t.stores)
        const importing = jest.spyOn(t.stores.database, "import")
        const storing = jest.spyOn(t.stores.storage, "import")

        await t.service.run(jobOf(TICK))

        expect(importing).not.toHaveBeenCalled()
        expect(storing).not.toHaveBeenCalled()
        expect(t.spools).toHaveLength(2)
    })

    it("has nothing to verify without a backup data set", async () => {
        const t = await build([], [])

        await expect(t.service.run(jobOf(TICK))).resolves.toEqual([])
    })
})

describe("DataVerifyService: what is wrong is one failure naming codes and ids", () => {
    it("catches a corrupted shard in a copy: the failure names the driver and the check, the other copy stays healthy", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const s3 = memoryDriver({ id: "s3-copy", kind: "s3" })
        const t = await build([git, s3])
        await writeCopy(git, t.stores)
        await writeCopy(s3, t.stores)
        git.corrupt("contacts", "ana@example.test")

        const failure = await t.service.run(jobOf(TICK)).catch((cause: unknown) => cause)

        expect(failure).toBeInstanceOf(QueueError)
        expect(classifyFailure(failure)).toBe("input")
        expect(failure).toMatchObject({
            params: { failureClass: "input", reason: text("nivo-lite: git-copy: failed") },
        })
        expect(t.logger.info).toHaveBeenCalledWith("data.verify.done", expect.objectContaining({ healthy: false }))
    })

    it("names a driver that holds no copy", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const s3 = memoryDriver({ id: "s3-copy", kind: "s3" })
        const t = await build([git, s3])
        await writeCopy(git, t.stores)

        const failure = await t.service.run(jobOf(TICK)).catch((cause: unknown) => cause)

        expect(failure).toMatchObject({ params: { failureClass: "input", reason: text("s3-copy: DATA_COPY_MISSING") } })
    })

    it("names the sets in which the copies differ", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const s3 = memoryDriver({ id: "s3-copy", kind: "s3" })
        const t = await build([git, s3])
        await writeCopy(git, t.stores, "2026-11-14T03:00:00.000Z")
        await changeRecord(t.stores.database, "contacts", "cy@example.test", { name: "Cy" })
        await writeCopy(s3, t.stores, "2026-11-14T04:00:00.000Z")

        const failure = await t.service.run(jobOf(TICK)).catch((cause: unknown) => cause)

        expect(failure).toMatchObject({ params: { reason: text("copies differ in database/contacts") } })
    })

    it("fails the restore check when the scratch export does not equal what the copy's manifest promises", async () => {
        const git = memoryDriver({ id: "git-copy" })
        const t = await build([])
        await writeCopy(git, t.stores)
        const lossy: DriverAdapter = {
            ...git,
            read: async (ref, context) => {
                const source = await git.read(ref, context)
                return { manifest: source.manifest, entries: (selection) => dropped(source.entries(selection)) }
            },
        }
        const verified = await build([lossy], [{ ...NIVO_SET, drivers: ["git-copy"] }])

        const failure = await verified.service.run(jobOf(TICK)).catch((cause: unknown) => cause)

        expect(failure).toMatchObject({ params: { reason: text("git-copy: failed restore") } })
    })
})

/** The entries of a copy without its first one: what a restore that lost an entry would read. */
async function* dropped<Item>(entries: AsyncIterable<Item>): AsyncIterable<Item> {
    let first = true
    for await (const item of entries) {
        if (first) first = false
        else yield item
    }
}

describe("DataVerifyService: failure classes", () => {
    it("a driver that cannot be reached is transient (the ladder), one that refuses for good is a configuration stop", async () => {
        const down = memoryDriver({
            id: "git-copy",
            fail: { on: "verify", code: "DATA_DRIVER_UNAVAILABLE", retry: "transient" },
        })
        const refused = memoryDriver({
            id: "git-copy",
            fail: { on: "verify", code: "DATA_SEAL_FAILED", retry: "configuration" },
        })
        const one = await build([down], [{ ...NIVO_SET, drivers: ["git-copy"] }])
        const other = await build([refused], [{ ...NIVO_SET, drivers: ["git-copy"] }])
        await writeCopy(down, one.stores)
        await writeCopy(refused, other.stores)

        expect(classifyFailure(await one.service.run(jobOf(TICK)).catch((cause: unknown) => cause))).toBe("transient")
        expect(classifyFailure(await other.service.run(jobOf(TICK)).catch((cause: unknown) => cause))).toBe("config")
    })

    it("a driver nothing provides is a missing setting", async () => {
        const t = await build([memoryDriver({ id: "git-copy" })])

        await expect(t.service.run(jobOf(TICK))).rejects.toMatchObject({
            params: { failureClass: "config", reason: text("s3-copy") },
        })
    })

    it("a payload that is no tick is refused before anything is read", async () => {
        const t = await build([])

        await expect(t.service.run(jobOf({ setId: "x" }))).rejects.toBeDefined()
    })
})
