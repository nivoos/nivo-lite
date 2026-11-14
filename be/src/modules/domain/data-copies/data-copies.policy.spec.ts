import { Test } from "@nestjs/testing"
import { DataRefusal, type CopyReceipt, type CopyRun, type DataManifest } from "@modules/integrations/seed"
import { attempt } from "@modules/platform/primitives"
import { classifyFailure } from "@modules/platform/queue"
import { manifestOf, memoryDriver, nivoStores } from "@tests/fixtures/builders/data-copies.builder"
import {
    backupFailureOf,
    countsOf,
    dataRefusalFailure,
    heldEverywhere,
    keptWriteOf,
    membersOf,
    receiptFromKept,
    warningsOf,
} from "./data-copies.policy"

const SUBJECT = Symbol("data-copies.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [
            {
                provide: SUBJECT,
                useValue: {
                    backupFailureOf,
                    countsOf,
                    dataRefusalFailure,
                    heldEverywhere,
                    keptWriteOf,
                    membersOf,
                    receiptFromKept,
                    warningsOf,
                },
            },
        ],
    }).compile()
    return moduleRef.get<typeof import("./data-copies.policy")>(SUBJECT)
}

const receiptOf = (driver: string, warnings: ReadonlyArray<string> = []): CopyReceipt => ({
    schema: "starci/data-copy@1",
    ref: {
        driver,
        kind: "git",
        locator: `${driver}@abc`,
        exportDigest: "digest-1",
        takenAt: "2026-11-14T03:00:00.000Z",
    },
    holding: { exportDigest: "digest-1", holds: "all", sets: [], omitted: [] },
    bytes: 10,
    changed: 3,
    warnings,
    at: "2026-11-14T03:00:01.000Z",
})

const legOf = (
    driver: string,
    outcome: CopyRun["legs"][number]["outcome"],
    failure: CopyRun["legs"][number]["failure"] = null,
    warnings: ReadonlyArray<string> = [],
): CopyRun["legs"][number] => ({
    driver,
    outcome,
    receipt: outcome === "failed" ? null : receiptOf(driver, warnings),
    failure,
})

const runOf = async (legs: ReadonlyArray<CopyRun["legs"][number]>): Promise<CopyRun> => ({
    manifest: await manifestOf(nivoStores()),
    legs,
    outcome: "partial",
})

describe("the stores and drivers a data set names", () => {
    it("finds the stores and drivers a set names, and refuses an id nothing provides as a missing setting", async () => {
        const subject = await build()
        const members = [{ id: "a" }, { id: "b" }]

        expect(subject.membersOf(members, ["b"], "store", "nivo-lite")).toEqual([{ id: "b" }])
        expect(attempt(() => subject.membersOf(members, ["c"], "driver", "nivo-lite"))).toMatchObject({
            ok: false,
            cause: {
                params: { failureClass: "config", reason: "data set nivo-lite names driver c, which is not bound" },
            },
        })
    })
})

describe("what a backup says of its export and what a ledger keeps of a write", () => {
    it("counts the items per set and collects what the drivers warned", async () => {
        const subject = await build()
        const manifest = await manifestOf(nivoStores())

        expect(subject.countsOf(manifest)).toEqual([
            { store: "database", set: "agents", items: 1 },
            { store: "database", set: "contacts", items: 2 },
            { store: "storage", set: "files", items: 1 },
        ])
        expect(
            subject.warningsOf(
                await runOf([legOf("git-copy", "written", null, ["DATA_GIT_CAP_NEAR"]), legOf("s3-copy", "unchanged")]),
            ),
        ).toEqual([{ driver: "git-copy", code: "DATA_GIT_CAP_NEAR" }])
    })

    it("is held everywhere only when every driver's newest copy is the export, and not when there is no driver", async () => {
        const subject = await build()
        const manifest = await manifestOf(nivoStores())

        expect(subject.heldEverywhere(manifest, [manifest.exportDigest, manifest.exportDigest])).toBe(true)
        expect(subject.heldEverywhere(manifest, [manifest.exportDigest, null])).toBe(false)
        expect(subject.heldEverywhere(manifest, [manifest.exportDigest, "other"])).toBe(false)
        expect(subject.heldEverywhere(manifest, [])).toBe(false)
    })

    it("rebuilds the receipt a replayed job answers with from what the ledger kept, with the driver's own plan", async () => {
        const subject = await build()
        const driver = memoryDriver({ id: "git-copy" })
        const manifest: DataManifest = await manifestOf(nivoStores())

        const rebuilt = subject.receiptFromKept(
            driver,
            manifest,
            subject.keptWriteOf(receiptOf("git-copy", ["DATA_GIT_CAP_NEAR"])),
        )

        expect(rebuilt).toMatchObject({
            schema: "starci/data-copy@1",
            ref: { driver: "git-copy", locator: "git-copy@abc", exportDigest: "digest-1" },
            bytes: 10,
            changed: 3,
            warnings: ["DATA_GIT_CAP_NEAR"],
        })
        expect(rebuilt.holding).toEqual(driver.plan(manifest))
    })

    it("refuses a kept value of another shape as input", async () => {
        const subject = await build()
        const driver = memoryDriver({ id: "git-copy" })
        const manifest = await manifestOf(nivoStores())

        for (const kept of [
            null,
            "text",
            { locator: 1 },
            { ...subject.keptWriteOf(receiptOf("git-copy")), warnings: [1] },
            { ...subject.keptWriteOf(receiptOf("git-copy")), bytes: "10" },
        ]) {
            expect(attempt(() => subject.receiptFromKept(driver, manifest, kept))).toMatchObject({
                ok: false,
                cause: {
                    params: { failureClass: "input", reason: "kept copy write of driver git-copy is unreadable" },
                },
            })
        }
    })
})

describe("the failure a backup run ends with", () => {
    it("is none when every driver holds the export", async () => {
        const subject = await build()

        expect(
            subject.backupFailureOf(
                "nivo-lite",
                await runOf([legOf("git-copy", "written"), legOf("s3-copy", "unchanged")]),
                new Map(),
            ),
        ).toBeNull()
    })

    it("is a configuration stop, naming the driver, the code and the copies kept, when a driver refused for good", async () => {
        const subject = await build()
        const run = await runOf([
            legOf("git-copy", "failed", { code: "DATA_GIT_CAP_EXCEEDED", retry: "configuration" }),
            legOf("s3-copy", "written"),
        ])

        const failure = subject.backupFailureOf("nivo-lite", run, new Map())

        expect(classifyFailure(failure)).toBe("config")
        expect(failure).toMatchObject({
            params: {
                reason: "backup of nivo-lite: driver git-copy refused with DATA_GIT_CAP_EXCEEDED (copies kept by s3-copy)",
            },
        })
    })

    it("is transient when a driver was unreachable, and says that no copy was written when none was", async () => {
        const subject = await build()
        const run = await runOf([legOf("git-copy", "failed", { code: "DATA_DRIVER_UNAVAILABLE", retry: "transient" })])

        const failure = subject.backupFailureOf("nivo-lite", run, new Map())

        expect(classifyFailure(failure)).toBe("transient")
        expect(failure).toMatchObject({
            params: {
                reason: "backup of nivo-lite: driver git-copy failed with DATA_DRIVER_UNAVAILABLE (no copy was written)",
            },
        })
    })
})

describe("the failure a backup run ends with: what is not a leg's own code", () => {
    it("keeps the class the one classifier gives a failure that is no data refusal, and the failure as the cause", async () => {
        const subject = await build()
        const run = await runOf([legOf("git-copy", "failed", { code: "DATA_DRIVER_UNAVAILABLE", retry: "transient" })])
        const bug = new TypeError("a bug")
        const network = Object.assign(new Error("reset"), { code: "ECONNRESET" })

        expect(classifyFailure(subject.backupFailureOf("nivo-lite", run, new Map([["git-copy", bug]])))).toBe("code")
        expect(classifyFailure(subject.backupFailureOf("nivo-lite", run, new Map([["git-copy", network]])))).toBe(
            "transient",
        )
        expect(subject.backupFailureOf("nivo-lite", run, new Map([["git-copy", bug]]))).toMatchObject({ cause: bug })
    })

    it("tells a data refusal's retry class apart: a configuration refusal stops, anything else is tried again", async () => {
        const subject = await build()

        expect(
            classifyFailure(
                subject.dataRefusalFailure(
                    new DataRefusal("DATA_SEAL_FAILED", "configuration", { driver: "git-copy" }),
                ),
            ),
        ).toBe("config")
        expect(
            classifyFailure(
                subject.dataRefusalFailure(
                    new DataRefusal("DATA_DRIVER_UNAVAILABLE", "transient", { driver: "git-copy" }),
                ),
            ),
        ).toBe("transient")
    })

    it("tells a store that was away for a moment from a store that is wrong: only a network cause makes a store failure transient", async () => {
        const subject = await build()
        const away = new DataRefusal(
            "DATA_STORE_FAILED",
            "configuration",
            { store: "database" },
            Object.assign(new Error("reset"), { code: "ECONNRESET" }),
        )
        const wrong = new DataRefusal(
            "DATA_STORE_FAILED",
            "configuration",
            { store: "database" },
            new Error("no such table"),
        )

        expect(classifyFailure(subject.dataRefusalFailure(away))).toBe("transient")
        expect(classifyFailure(subject.dataRefusalFailure(wrong))).toBe("config")
    })
})
