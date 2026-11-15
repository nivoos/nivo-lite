import { blobEntry, recordEntry, type DataEntry } from "@modules/integrations/seed"
import {
    MemoryWorkspaceDirectory,
    MemoryWorkspaceObjects,
    collectEntries,
    entriesFrom,
    storeContract,
} from "@tests/fixtures/builders/data-stores.builder"
import { DataRefusalCode, FILES_SET, STORAGE_CANNOT } from "./data-stores.policy"
import { DataStoresErrorCode } from "./errors/data-stores.error"
import { WorkspaceStorageStore } from "./workspace-storage.adapter"

const DIRECTORY = new MemoryWorkspaceDirectory({ "nivo-web": { id: "ws-1", ownerId: "owner-1" } })
const SCOPE = { workspace: "nivo-web" }
const bytes = (...values: ReadonlyArray<number>): Uint8Array => new Uint8Array(values)

const SEED = {
    "ws-1": {
        "video.project/rec-1/cover/obj-1": { bytes: bytes(1, 2, 3), mime: "image/png" },
        "staged/obj-2": { bytes: bytes(9), mime: "video/mp4" },
        "a/b": { bytes: bytes(7, 7), mime: "text/plain" },
    },
    "ws-2": { "other/file": { bytes: bytes(5), mime: "text/plain" } },
}

const storeOf = (objects: MemoryWorkspaceObjects): WorkspaceStorageStore =>
    new WorkspaceStorageStore(DIRECTORY, objects, STORAGE_CANNOT, SCOPE)

describe("WorkspaceStorageStore: the store contract of the data standard", () => {
    for (const contract of storeContract(
        () => Promise.resolve(storeOf(new MemoryWorkspaceObjects(SEED))),
        () => Promise.resolve(storeOf(new MemoryWorkspaceObjects())),
    )) {
        it(contract.name, contract.run)
    }
})

describe("WorkspaceStorageStore", () => {
    it("describes one blob set and says why other buckets and unreferenced objects are not held", async () => {
        const description = await storeOf(new MemoryWorkspaceObjects(SEED)).describe()
        expect(description.sets).toEqual([{ set: FILES_SET, schema: "blob@1", form: "blob" }])
        expect(description.cannot.length).toBeGreaterThan(0)
        expect(description.cannot.every((item) => item.reason !== "")).toBe(true)
    })

    it("exports the keys relative to the workspace prefix, in byte order, and only this workspace", async () => {
        const entries = await collectEntries(storeOf(new MemoryWorkspaceObjects(SEED)).export({}))
        expect(entries.map((entry) => entry.key)).toEqual(["a/b", "staged/obj-2", "video.project/rec-1/cover/obj-1"])
        expect(entries.every((entry) => entry.form === "blob" && !entry.key.includes("ws-1"))).toBe(true)
        expect(entries[2]?.media).toBe("image/png")
    })

    it("answers the full object key as the identity of a held object, null when absent", async () => {
        const store = storeOf(new MemoryWorkspaceObjects(SEED))
        expect(await store.identityOf(FILES_SET, "a/b")).toBe("ws-1/a/b")
        expect(await store.identityOf(FILES_SET, "nothing")).toBeNull()
        expect(await store.identityOf("other-set", "a/b")).toBeNull()
    })

    it("puts an object only when its content or type differs", async () => {
        const objects = new MemoryWorkspaceObjects(SEED)
        const store = storeOf(objects)
        const same = blobEntry(FILES_SET, "a/b", bytes(7, 7), "text/plain")
        const retyped = blobEntry(FILES_SET, "a/b", bytes(7, 7), "text/markdown")
        const fresh = blobEntry(FILES_SET, "n/new", bytes(4), "text/plain")
        const report = await store.import(entriesFrom([same, fresh]), { dryRun: false, mode: "merge" })
        expect(report.sets).toEqual([{ set: FILES_SET, created: 1, updated: 0, unchanged: 1, removed: 0, refused: [] }])
        expect(objects.calls.filter((call) => call.startsWith("write"))).toEqual(["write ws-1/n/new"])
        const retype = await store.import(entriesFrom([retyped]), { dryRun: false, mode: "merge" })
        expect(retype.sets[0]?.updated).toBe(1)
    })
})

describe("WorkspaceStorageStore: the changes an import makes", () => {
    it("deletes nothing in a merge, and in a mirror only the keys the entries lack", async () => {
        const objects = new MemoryWorkspaceObjects(SEED)
        const store = storeOf(objects)
        await store.import(entriesFrom([blobEntry(FILES_SET, "a/b", bytes(7, 7), "text/plain")]), {
            dryRun: false,
            mode: "merge",
        })
        expect(objects.calls.some((call) => call.startsWith("remove"))).toBe(false)
        const dry = await store.import(entriesFrom([blobEntry(FILES_SET, "a/b", bytes(7, 7), "text/plain")]), {
            dryRun: true,
            mode: "mirror",
        })
        expect(dry.sets[0]?.removed).toBe(2)
        expect(objects.calls.some((call) => call.startsWith("remove"))).toBe(false)
        const mirror = await store.import(entriesFrom([blobEntry(FILES_SET, "a/b", bytes(7, 7), "text/plain")]), {
            dryRun: false,
            mode: "mirror",
        })
        expect(mirror.sets[0]?.removed).toBe(2)
        expect(objects.calls.filter((call) => call.startsWith("remove")).sort()).toEqual([
            "remove ws-1/staged/obj-2",
            "remove ws-1/video.project/rec-1/cover/obj-1",
        ])
        expect(await objects.keys("ws-2")).toEqual(["other/file"])
    })

    it("refuses a record entry, an unknown set and a corrupt blob by key and code", async () => {
        const store = storeOf(new MemoryWorkspaceObjects())
        const corrupt: DataEntry = { ...blobEntry(FILES_SET, "c", bytes(1), "text/plain"), sha256: "0".repeat(64) }
        const report = await store.import(
            entriesFrom([recordEntry(FILES_SET, "r", { a: 1 }), blobEntry("other", "o", bytes(1), "x/y"), corrupt]),
            {
                dryRun: false,
                mode: "merge",
            },
        )
        expect(report.outcome).toBe("partial")
        expect(report.sets.find((item) => item.set === FILES_SET)?.refused.map((item) => item.key)).toEqual(["r", "c"])
        expect(report.sets.find((item) => item.set === "other")?.refused).toHaveLength(1)
    })

    it("refuses a workspace nobody holds; a call that names none is the whole deployment", async () => {
        const unbound = new WorkspaceStorageStore(DIRECTORY, new MemoryWorkspaceObjects(), [])
        expect(await collectEntries(unbound.export({}))).toEqual([])
        await expect(collectEntries(unbound.export({ scope: { workspace: "nobody" } }))).rejects.toMatchObject({
            code: DataStoresErrorCode.ScopeUnknown,
        })
    })
})

const WS_A = "0a000000-0000-4000-8000-00000000000a"
const WS_B = "0b000000-0000-4000-8000-00000000000b"
const ALL = new MemoryWorkspaceDirectory({
    "ws-a": { id: WS_A, ownerId: "owner-a" },
    "ws-b": { id: WS_B, ownerId: "owner-b" },
})
const FILES = {
    [WS_B]: { "x/two": { bytes: bytes(2), mime: "text/plain" } },
    [WS_A]: { "x/one": { bytes: bytes(1), mime: "image/png" }, "a/zero": { bytes: bytes(0), mime: "text/plain" } },
}
const deploymentOf = (objects: MemoryWorkspaceObjects): WorkspaceStorageStore =>
    new WorkspaceStorageStore(ALL, objects, STORAGE_CANNOT)

describe("WorkspaceStorageStore: a call that names no workspace is every workspace", () => {
    it("exports every live workspace's objects with the key prefixed by the workspace id, in key byte order", async () => {
        const entries = await collectEntries(deploymentOf(new MemoryWorkspaceObjects(FILES)).export({}))
        expect(entries.map((entry) => entry.key)).toEqual([`${WS_A}/a/zero`, `${WS_A}/x/one`, `${WS_B}/x/two`])
    })

    it("no workspace, or workspaces whose bucket holds nothing, exports an empty set: a valid export", async () => {
        const none = new WorkspaceStorageStore(new MemoryWorkspaceDirectory({}), new MemoryWorkspaceObjects(FILES), [])
        expect(await collectEntries(none.export({}))).toEqual([])
        expect(await collectEntries(deploymentOf(new MemoryWorkspaceObjects()).export({}))).toEqual([])
    })

    it("round trip: an import without a scope writes each object into the workspace its prefix names, with its bytes and type", async () => {
        const copy = await collectEntries(deploymentOf(new MemoryWorkspaceObjects(FILES)).export({}))
        const target = new MemoryWorkspaceObjects()

        const report = await deploymentOf(target).import(entriesFrom(copy), { dryRun: false, mode: "merge" })

        expect(report.outcome).toBe("applied")
        expect(target.calls).toEqual([
            `read ${WS_A}/a/zero`,
            `write ${WS_A}/a/zero`,
            `read ${WS_A}/x/one`,
            `write ${WS_A}/x/one`,
            `read ${WS_B}/x/two`,
            `write ${WS_B}/x/two`,
        ])
        expect(await target.read(WS_B, "x/two")).toEqual({ bytes: bytes(2), mime: "text/plain" })
        expect(await deploymentOf(target).identityOf(FILES_SET, `${WS_A}/x/one`)).toBe(`${WS_A}/x/one`)
        expect(await deploymentOf(target).identityOf(FILES_SET, `${WS_B}/x/one`)).toBeNull()
    })

    it("a key whose prefix names no live workspace is a refused key with its code, not a throw; nothing is written for it", async () => {
        const target = new MemoryWorkspaceObjects()
        const stranger = "0c000000-0000-4000-8000-00000000000c"
        const report = await deploymentOf(target).import(
            entriesFrom([
                blobEntry(FILES_SET, `${stranger}/x`, bytes(1), "text/plain"),
                blobEntry(FILES_SET, "plain", bytes(1), "text/plain"),
            ]),
            { dryRun: false, mode: "merge" },
        )
        expect(report.outcome).toBe("partial")
        expect(report.sets[0]?.refused).toEqual([
            { key: `${stranger}/x`, code: DataRefusalCode.WorkspaceUnknown },
            { key: "plain", code: DataRefusalCode.WorkspaceUnknown },
        ])
        expect(target.calls).toEqual([])
    })
})
