import { Test } from "@nestjs/testing"
import type { CopyVerdict, DataManifest } from "@modules/integrations/seed"
import { manifestOf, memoryDriver, nivoStores } from "@tests/fixtures/builders/data-copies.builder"
import {
    missingCopyOf,
    restoreCheckOf,
    restoreMismatches,
    verificationOf,
    verifyProblemsOf,
    verifyReceiptOf,
} from "./data-verify.policy"

const SUBJECT = Symbol("data-verify.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [
            {
                provide: SUBJECT,
                useValue: {
                    missingCopyOf,
                    restoreCheckOf,
                    restoreMismatches,
                    verificationOf,
                    verifyProblemsOf,
                    verifyReceiptOf,
                },
            },
        ],
    }).compile()
    return moduleRef.get<typeof import("./data-verify.policy")>(SUBJECT)
}

/** A verdict a driver gave its newest copy: healthy or not, one check. */
const verdictOf = (healthy: boolean): CopyVerdict => ({
    ref: {
        driver: "git-copy",
        kind: "git",
        locator: "git-copy@abc",
        exportDigest: "digest-1",
        takenAt: "2026-11-14T03:00:00.000Z",
    },
    healthy,
    checks: [{ name: "digests", ok: healthy, detail: "" }],
    manifest: null,
})

describe("what the verify of a copy finds: the restored export", () => {
    it("names the sets whose restored export differs from the manifest: a missing set, another digest or another count", async () => {
        const subject = await build()
        const manifest = await manifestOf(nivoStores())
        const restored: DataManifest = {
            ...manifest,
            sets: manifest.sets
                .filter((set) => set.set !== "agents")
                .map((set) => (set.set === "files" ? { ...set, digest: "other" } : { ...set, items: set.items + 1 })),
        }

        expect(subject.restoreMismatches(manifest, manifest)).toEqual([])
        expect(subject.restoreMismatches(manifest, restored)).toEqual([
            "database/agents",
            "database/contacts",
            "storage/files",
        ])
    })

    it("passes the restore check when the import was whole and the export equals the manifest, else says what differs", async () => {
        const subject = await build()

        expect(subject.restoreCheckOf([], false)).toEqual({
            name: "restore",
            ok: true,
            detail: "scratch export equals the manifest",
        })
        expect(subject.restoreCheckOf(["database/contacts"], false)).toEqual({
            name: "restore",
            ok: false,
            detail: "differs: database/contacts",
        })
        expect(subject.restoreCheckOf([], true)).toEqual({
            name: "restore",
            ok: false,
            detail: "differs:  (an import was refused)",
        })
    })
})

describe("what the verify of a copy finds: the copy and the set", () => {
    it("is healthy when every check passes, and names the failed checks of a copy that is not", async () => {
        const subject = await build()
        const driver = memoryDriver({ id: "git-copy" })
        const verdict = verdictOf(true)

        const healthy = subject.verificationOf(driver, verdict.ref, verdict, { name: "restore", ok: true, detail: "" })
        const sick = subject.verificationOf(driver, verdict.ref, verdictOf(false), null)

        expect(healthy).toMatchObject({
            findings: [],
            copy: { driver: "git-copy", ref: "git-copy@abc", healthy: true },
        })
        expect(healthy.copy?.checks.map((check) => check.name)).toEqual(["digests", "restore"])
        expect(sick.findings).toEqual(["git-copy: failed digests"])
        expect(subject.missingCopyOf(driver)).toEqual({
            verdict: null,
            copy: null,
            findings: ["git-copy: DATA_COPY_MISSING"],
        })
    })

    it("makes the receipt of a set from what each driver found, and the one reason of a verify from the sets with findings", async () => {
        const subject = await build()
        const driver = memoryDriver({ id: "git-copy" })
        const verdict = verdictOf(true)
        const found = [
            subject.verificationOf(driver, verdict.ref, verdict, null),
            subject.missingCopyOf(memoryDriver({ id: "s3-copy" })),
        ]

        const receipt = subject.verifyReceiptOf("nivo-lite", "2026-11-14T10:00:00.000Z", found, ["database/contacts"])

        expect(receipt).toMatchObject({
            setId: "nivo-lite",
            healthy: false,
            findings: ["s3-copy: DATA_COPY_MISSING", "copies differ in database/contacts"],
        })
        expect(receipt.copies).toHaveLength(1)
        expect(subject.verifyReceiptOf("nivo-lite", "x", [found[0] ?? subject.missingCopyOf(driver)], []).healthy).toBe(
            true,
        )
        expect(subject.verifyProblemsOf([receipt, { ...receipt, setId: "fine", healthy: true, findings: [] }])).toBe(
            "verify found problems: nivo-lite: s3-copy: DATA_COPY_MISSING; copies differ in database/contacts",
        )
    })
})
