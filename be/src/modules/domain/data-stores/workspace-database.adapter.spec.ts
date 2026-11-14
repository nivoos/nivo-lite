import { blobEntry, recordEntry, type DataEntry, type JsonValue } from "@modules/integrations/seed"
import {
    MemorySetDoor,
    MemoryWorkspaceDirectory,
    collectEntries,
    entriesFrom,
    storeContract,
} from "@tests/fixtures/builders/data-stores.builder"
import { DATABASE_CANNOT, DataRefusalCode } from "./data-stores.policy"
import { DataStoresError, DataStoresErrorCode } from "./errors/data-stores.error"
import { WorkspaceDatabaseStore } from "./workspace-database.adapter"

const DIRECTORY = new MemoryWorkspaceDirectory({ "nivo-web": { id: "ws-1", ownerId: "owner-1" } })
const SCOPE = { workspace: "nivo-web" }

const SETTINGS: Readonly<Record<string, JsonValue>> = {
    settings: { name: "NIVO Web", theme: null, timeZone: "Asia/Ho_Chi_Minh" },
}
const ALPHA: JsonValue = { content: "a", module: "sales", topic: "t", visibility: "public" }
/** An accented letter (U+00E9), built from its code point so the source stays ASCII: its UTF-8 bytes sort after every ASCII key. */
const ACCENTED = String.fromCodePoint(0xe9)
const KNOWLEDGE: Readonly<Record<string, JsonValue>> = {
    "seed%3Anivo/Zeta": { content: "z", module: null, topic: "", visibility: "internal" },
    "seed%3Anivo/Alpha": ALPHA,
    [`seed%3Anivo/${ACCENTED}clair`]: { content: "e", module: null, topic: "", visibility: "internal" },
}

const storeOf = (seed: boolean, removable = false): WorkspaceDatabaseStore =>
    new WorkspaceDatabaseStore(
        DIRECTORY,
        [
            new MemorySetDoor("workspace", seed ? SETTINGS : {}),
            new MemorySetDoor("knowledge", seed ? KNOWLEDGE : {}, removable),
        ],
        DATABASE_CANNOT,
        SCOPE,
    )

describe("WorkspaceDatabaseStore: the store contract of the data standard", () => {
    for (const contract of storeContract(
        () => Promise.resolve(storeOf(true)),
        () => Promise.resolve(storeOf(false)),
    )) {
        it(contract.name, contract.run)
    }
})

describe("WorkspaceDatabaseStore: what it holds and how it is scoped", () => {
    it("describes both sets sorted, with record schemas, and says what it cannot do with the reason", async () => {
        const description = await storeOf(true).describe()
        expect(description.sets).toEqual([
            { set: "knowledge", schema: "nivo-seed-standard/knowledge@1", form: "record" },
            { set: "workspace", schema: "nivo-seed-standard/workspace@1", form: "record" },
        ])
        expect(description.cannot.map((item) => item.what)).toEqual(
            expect.arrayContaining([expect.stringContaining("records"), expect.stringContaining("credentials")]),
        )
        expect(description.cannot.every((item) => item.reason !== "")).toBe(true)
    })

    it("exports in UTF-8 byte order: the accented key sorts after the ASCII ones", async () => {
        const keys = (await collectEntries(storeOf(true).export({}))).map((item) => `${item.set}/${item.key}`)
        expect(keys).toEqual([
            "knowledge/seed%3Anivo/Alpha",
            "knowledge/seed%3Anivo/Zeta",
            `knowledge/seed%3Anivo/${ACCENTED}clair`,
            "workspace/settings",
        ])
    })

    it("refuses a call that names no workspace, and one that names a workspace nobody holds", async () => {
        const unbound = new WorkspaceDatabaseStore(DIRECTORY, [new MemorySetDoor("workspace")], [])
        await expect(collectEntries(unbound.export({}))).rejects.toMatchObject({
            code: DataStoresErrorCode.ScopeRequired,
        })
        await expect(collectEntries(unbound.export({ scope: { workspace: "nobody" } }))).rejects.toMatchObject({
            code: DataStoresErrorCode.ScopeUnknown,
        })
        expect(await collectEntries(unbound.export({ scope: SCOPE }))).toEqual([])
    })

    it("takes the workspace from the scope of the call, and `within` binds one for an identity question", async () => {
        const unbound = new WorkspaceDatabaseStore(DIRECTORY, [new MemorySetDoor("workspace", SETTINGS)], [])
        expect(await collectEntries(unbound.export({ scope: SCOPE }))).toHaveLength(1)
        expect(await unbound.within(SCOPE).identityOf("workspace", "settings")).toMatch(/^row-/u)
        expect(await unbound.within(SCOPE).identityOf("workspace", "nothing")).toBeNull()
        expect(await unbound.within(SCOPE).identityOf("no-such-set", "settings")).toBeNull()
    })
})

describe("WorkspaceDatabaseStore: import", () => {
    const entry = (set: string, key: string, value: JsonValue): DataEntry => recordEntry(set, key, value)

    it("counts a dry run exactly and writes nothing", async () => {
        const store = storeOf(true)
        const report = await store.import(
            entriesFrom([
                entry("knowledge", "seed%3Anivo/Alpha", ALPHA),
                entry("knowledge", "seed%3Anivo/Zeta", {
                    content: "changed",
                    module: null,
                    topic: "",
                    visibility: "internal",
                }),
                entry("knowledge", "seed%3Anivo/New", {
                    content: "n",
                    module: null,
                    topic: "",
                    visibility: "internal",
                }),
            ]),
            { dryRun: true, mode: "merge", scope: SCOPE },
        )
        expect(report.sets).toEqual([
            { set: "knowledge", created: 1, updated: 1, unchanged: 1, removed: 0, refused: [] },
        ])
        expect(report.outcome).toBe("applied")
        const after = await collectEntries(store.export({ sets: ["knowledge"] }))
        expect(after.map((item) => item.key)).not.toContain("seed%3Anivo/New")
    })

    it("reports a key the door refuses with its code, keeps the rest, and answers partial", async () => {
        const door = new MemorySetDoor("knowledge")
        door.refuse.set("bad", new DataStoresError({ code: DataStoresErrorCode.StorageUnavailable }))
        const store = new WorkspaceDatabaseStore(DIRECTORY, [door], [], SCOPE)
        const report = await store.import(
            entriesFrom([entry("knowledge", "bad", { a: 1 }), entry("knowledge", "good", { a: 2 })]),
            {
                dryRun: false,
                mode: "merge",
            },
        )
        expect(report.outcome).toBe("partial")
        expect(report.sets[0]).toMatchObject({
            created: 1,
            refused: [{ key: "bad", code: DataStoresErrorCode.StorageUnavailable }],
        })
    })

    it("refuses an unknown set, a blob entry and a corrupt entry by key and code, never by value", async () => {
        const store = storeOf(false)
        const corrupt: DataEntry = { ...entry("knowledge", "k", { a: 1 }), sha256: "0".repeat(64) }
        const report = await store.import(
            entriesFrom([
                entry("no-such-set", "x", { a: 1 }),
                blobEntry("knowledge", "blob", new Uint8Array([1]), "image/png"),
                corrupt,
            ]),
            { dryRun: false, mode: "merge" },
        )
        expect(report.outcome).toBe("partial")
        expect(report.sets.find((item) => item.set === "no-such-set")?.refused).toEqual([
            { key: "x", code: DataRefusalCode.SetUnknown },
        ])
        expect(report.sets.find((item) => item.set === "knowledge")?.refused).toEqual([
            { key: "blob", code: DataRefusalCode.FormMismatch },
            { key: "k", code: DataRefusalCode.EntryCorrupt },
        ])
    })

    it("rethrows a failure that is no refusal, so the job runner judges it", async () => {
        const door = new MemorySetDoor("knowledge")
        jest.spyOn(door, "write").mockRejectedValue(new Error("connection reset"))
        const store = new WorkspaceDatabaseStore(DIRECTORY, [door], [], SCOPE)
        await expect(
            store.import(entriesFrom([entry("knowledge", "k", { a: 1 })]), { dryRun: false, mode: "merge" }),
        ).rejects.toThrow("connection reset")
    })
})

describe("WorkspaceDatabaseStore: mirror", () => {
    const entry = (set: string, key: string, value: JsonValue): DataEntry => recordEntry(set, key, value)

    it("removes, through the removing door of the set, the keys of a named set the entries lack", async () => {
        const store = storeOf(true, true)
        const report = await store.import(entriesFrom([entry("knowledge", "seed%3Anivo/Alpha", ALPHA)]), {
            dryRun: false,
            mode: "mirror",
        })
        expect(report.sets).toEqual([
            { set: "knowledge", created: 0, updated: 0, unchanged: 1, removed: 2, refused: [] },
        ])
        expect((await collectEntries(store.export({ sets: ["knowledge"] }))).map((item) => item.key)).toEqual([
            "seed%3Anivo/Alpha",
        ])
        expect(await collectEntries(store.export({ sets: ["workspace"] }))).toHaveLength(1)
    })

    it("counts the removals of a dry run and removes nothing", async () => {
        const store = storeOf(true, true)
        const report = await store.import(entriesFrom([entry("knowledge", "seed%3Anivo/Alpha", ALPHA)]), {
            dryRun: true,
            mode: "mirror",
        })
        expect(report.sets[0]?.removed).toBe(2)
        expect(await collectEntries(store.export({ sets: ["knowledge"] }))).toHaveLength(3)
    })

    it("reports, never removes, the keys of a set whose module has no removing door", async () => {
        const store = storeOf(true, false)
        const report = await store.import(entriesFrom([entry("knowledge", "only", { a: 1 })]), {
            dryRun: false,
            mode: "mirror",
        })
        expect(report.outcome).toBe("partial")
        expect(report.sets[0]?.refused.map((item) => item.code)).toEqual([
            DataRefusalCode.NotRemovable,
            DataRefusalCode.NotRemovable,
            DataRefusalCode.NotRemovable,
        ])
        expect(await collectEntries(store.export({ sets: ["knowledge"] }))).toHaveLength(4)
    })
})
