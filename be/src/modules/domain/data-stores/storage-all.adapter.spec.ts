import { blobEntry, recordEntry } from "@modules/integrations/seed"
import {
    MemoryStorageBuckets,
    collectEntries,
    entriesFrom,
    storeContract,
    type BucketSeed,
} from "@tests/fixtures/builders/data-stores.builder"
import { DataRefusalCode } from "./data-stores.policy"
import { DataStoresErrorCode } from "./errors/data-stores.error"
import { STORAGE_ALL_STORE_ID, StorageAllStore } from "./storage-all.adapter"

const OWNED = ["avatars-public", "knowledge-uploads", "media", "records"]
const bytes = (...values: ReadonlyArray<number>): Uint8Array => new Uint8Array(values)

const SEED: BucketSeed = {
    records: {
        "ws-1/video.project/rec-1/cover/obj-1": { bytes: bytes(1, 2, 3), mime: "image/png" },
        "ws-1/staged/obj-2": { bytes: bytes(9), mime: "video/mp4" },
        "ws-2/a": { bytes: bytes(7, 7), mime: "text/plain" },
    },
    "avatars-public": { "u1.png": { bytes: bytes(5), mime: "image/png" } },
}

/** A store over memory buckets, and the buckets whose calls a spec reads. */
interface Built {
    readonly store: StorageAllStore
    readonly buckets: MemoryStorageBuckets
}

const storeOf = (seed: BucketSeed = SEED): Built => {
    const buckets = new MemoryStorageBuckets(OWNED, seed)
    return { store: new StorageAllStore(buckets), buckets }
}

describe("StorageAllStore: the store contract of the data standard", () => {
    for (const contract of storeContract(
        () => Promise.resolve(storeOf().store),
        () => Promise.resolve(storeOf({}).store),
    )) {
        it(contract.name, contract.run)
    }
})

describe("StorageAllStore", () => {
    it("is the whole deployment's storage store and describes one blob set per owned bucket, saying what it cannot do", async () => {
        const { store } = storeOf()
        const description = await store.describe()

        expect(store.id).toBe(STORAGE_ALL_STORE_ID)
        expect(store.kind).toBe("storage")
        expect(description.sets.map((set) => set.set)).toEqual(OWNED)
        expect(description.sets.every((set) => set.schema === "blob@1" && set.form === "blob")).toBe(true)
        expect(description.cannot.every((item) => item.reason !== "")).toBe(true)
    })

    it("exports every object of every bucket in (set, key) byte order with its content type; an empty or missing bucket is an empty set", async () => {
        const entries = await collectEntries(storeOf().store.export({}))

        expect(entries.map((entry) => `${entry.set}/${entry.key}`)).toEqual([
            "avatars-public/u1.png",
            "records/ws-1/staged/obj-2",
            "records/ws-1/video.project/rec-1/cover/obj-1",
            "records/ws-2/a",
        ])
        expect(entries[3]?.media).toBe("text/plain")
        expect(await collectEntries(storeOf({}).store.export({}))).toEqual([])
    })

    it("walks a bucket page by page: more keys than one page are all exported", async () => {
        const many = Object.fromEntries(
            Array.from({ length: 1203 }, (_, at) => [
                `k/${String(at).padStart(5, "0")}`,
                { bytes: bytes(at % 250), mime: "a/b" },
            ]),
        )
        const { store, buckets } = storeOf({ media: many })

        const entries = await collectEntries(store.export({ sets: ["media"] }))

        expect(entries).toHaveLength(1203)
        expect(buckets.calls.filter((call) => call.startsWith("keys media/"))).toHaveLength(4)
    })


    it("answers an object's own place as its identity, null when it is absent or the set is not owned", async () => {
        const { store } = storeOf()

        expect(await store.identityOf("records", "ws-2/a")).toBe("records/ws-2/a")
        expect(await store.identityOf("records", "nothing")).toBeNull()
        expect(await store.identityOf("elsewhere", "a")).toBeNull()
    })

    it("skips an object that vanished between the listing and the read", async () => {
        const { store, buckets } = storeOf({ media: { a: { bytes: bytes(1), mime: "a/b" } } })
        jest.spyOn(buckets, "read").mockResolvedValue(null)

        expect(await collectEntries(store.export({ sets: ["media"] }))).toEqual([])
    })
})

describe("StorageAllStore: what an import changes", () => {
    it("refuses a scope and a mirror: it is the whole deployment and never deletes", async () => {
        const { store } = storeOf()

        await expect(collectEntries(store.export({ scope: { workspace: "x" } }))).rejects.toMatchObject({
            code: DataStoresErrorCode.CallUnsupported,
        })
        await expect(store.import(entriesFrom([]), { dryRun: false, mode: "mirror" })).rejects.toMatchObject({
            code: DataStoresErrorCode.CallUnsupported,
        })
        await expect(
            store.import(entriesFrom([]), { dryRun: false, mode: "merge", scope: { workspace: "x" } }),
        ).rejects.toMatchObject({ code: DataStoresErrorCode.CallUnsupported })
    })

    it("puts an object only when it is missing or its type or bytes differ, and creates a missing bucket", async () => {
        const { store, buckets } = storeOf()
        const same = blobEntry("records", "ws-2/a", bytes(7, 7), "text/plain")
        const retyped = blobEntry("records", "ws-2/a", bytes(7, 7), "text/markdown")
        const changed = blobEntry("records", "ws-2/a", bytes(7, 8), "text/markdown")
        const fresh = blobEntry("media", "n/new", bytes(4), "text/plain")

        const first = await store.import(entriesFrom([fresh, same]), { dryRun: false, mode: "merge" })
        expect(first.sets).toEqual([
            { set: "media", created: 1, updated: 0, unchanged: 0, removed: 0, refused: [] },
            { set: "records", created: 0, updated: 0, unchanged: 1, removed: 0, refused: [] },
        ])
        expect(buckets.calls.filter((call) => call.startsWith("write"))).toEqual(["write media/n/new"])

        expect((await store.import(entriesFrom([retyped]), { dryRun: false, mode: "merge" })).sets[0]?.updated).toBe(1)
        expect((await store.import(entriesFrom([changed]), { dryRun: false, mode: "merge" })).sets[0]?.updated).toBe(1)
        expect((await store.import(entriesFrom([changed]), { dryRun: false, mode: "merge" })).outcome).toBe("unchanged")
    })

    it("compares same-size objects by their bytes", async () => {
        const { store } = storeOf()

        const report = await store.import(entriesFrom([blobEntry("records", "ws-2/a", bytes(7, 6), "text/plain")]), {
            dryRun: false,
            mode: "merge",
        })

        expect(report.sets[0]?.updated).toBe(1)
    })

    it("writes nothing in a dry run, and refuses a set it does not own, a record entry and a corrupt body, by key and code only", async () => {
        const { store, buckets } = storeOf()
        const corrupt = { ...blobEntry("media", "x", bytes(1), "a/b"), body: bytes(2) }

        const report = await store.import(
            entriesFrom([
                blobEntry("media", "dry", bytes(1), "a/b"),
                blobEntry("elsewhere", "k", bytes(1), "a/b"),
                recordEntry("media", "r", { a: 1 }),
                corrupt,
            ]),
            { dryRun: true, mode: "merge" },
        )

        expect(buckets.calls.some((call) => call.startsWith("write"))).toBe(false)
        expect(report.outcome).toBe("partial")
        expect(report.sets.find((set) => set.set === "elsewhere")?.refused).toEqual([
            { key: "k", code: DataRefusalCode.SetUnknown },
        ])
        expect(report.sets.find((set) => set.set === "media")).toMatchObject({
            created: 1,
            refused: [
                { key: "r", code: DataRefusalCode.FormMismatch },
                { key: "x", code: DataRefusalCode.EntryCorrupt },
            ],
        })
    })
})
