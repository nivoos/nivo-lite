import { blobEntry, recordEntry, type DataEntry } from "@modules/integrations/seed"
import {
    MemoryWorkspaceDirectory,
    MemoryWorkspaceObjects,
    collectEntries,
    entriesFrom,
    storeContract,
} from "@tests/fixtures/builders/data-stores.builder"
import { FILES_SET, STORAGE_CANNOT } from "./data-stores.policy"
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

    it("needs a workspace and a known one", async () => {
        const unbound = new WorkspaceStorageStore(DIRECTORY, new MemoryWorkspaceObjects(), [])
        await expect(collectEntries(unbound.export({}))).rejects.toMatchObject({
            code: DataStoresErrorCode.ScopeRequired,
        })
        await expect(collectEntries(unbound.export({ scope: { workspace: "nobody" } }))).rejects.toMatchObject({
            code: DataStoresErrorCode.ScopeUnknown,
        })
    })
})
