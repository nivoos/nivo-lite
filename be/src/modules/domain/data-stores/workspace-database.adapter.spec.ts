import { blobEntry, recordEntry, type DataEntry, type JsonValue } from "@modules/integrations/seed"
import {
    MemorySetDoor,
    MemoryWorkspaceDirectory,
    WorkspaceSetDoor,
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

    it("refuses a call that names a workspace nobody holds; a call that names none is the whole deployment", async () => {
        const unbound = new WorkspaceDatabaseStore(DIRECTORY, [new MemorySetDoor("workspace")], [])
        expect(await collectEntries(unbound.export({}))).toEqual([])
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

const WS_A = "0a000000-0000-4000-8000-00000000000a"
const WS_B = "0b000000-0000-4000-8000-00000000000b"
const ALL = new MemoryWorkspaceDirectory({
    "ws-a": { id: WS_A, ownerId: "owner-a" },
    "ws-b": { id: WS_B, ownerId: "owner-b" },
})
/** The record a knowledge row of the all-workspaces specs holds. */
const note = (content: string): JsonValue => ({ content, module: null, topic: "", visibility: "internal" })

const deploymentOf = (seed: boolean): WorkspaceDatabaseStore =>
    new WorkspaceDatabaseStore(
        ALL,
        [
            new WorkspaceSetDoor(
                "knowledge",
                seed ? { [WS_B]: { "o/two": note("b") }, [WS_A]: { "o/one": note("a"), "o/0": note("z") } } : {},
            ),
            new WorkspaceSetDoor(
                "workspace",
                seed ? { [WS_A]: { settings: { name: "A" } }, [WS_B]: { settings: { name: "B" } } } : {},
            ),
        ],
        [],
    )

describe("WorkspaceDatabaseStore: a call that names no workspace is every workspace", () => {
    it("exports every live workspace's sets, each key prefixed with the workspace id, in (set, key) byte order", async () => {
        const keys = (await collectEntries(deploymentOf(true).export({}))).map((item) => `${item.set}|${item.key}`)
        expect(keys).toEqual([
            `knowledge|${WS_A}/o/0`,
            `knowledge|${WS_A}/o/one`,
            `knowledge|${WS_B}/o/two`,
            `workspace|${WS_A}/settings`,
            `workspace|${WS_B}/settings`,
        ])
    })

    it("a deployment with no workspace, or workspaces with no rows, exports an empty set: a valid export, never a failure", async () => {
        const none = new WorkspaceDatabaseStore(
            new MemoryWorkspaceDirectory({}),
            [new WorkspaceSetDoor("workspace")],
            [],
        )
        expect(await collectEntries(none.export({}))).toEqual([])
        expect(await collectEntries(deploymentOf(false).export({}))).toEqual([])
    })

    it("a scoped call still exports one workspace with plain keys", async () => {
        const keys = (await collectEntries(deploymentOf(true).export({ scope: { workspace: "ws-b" } }))).map(
            (item) => `${item.set}|${item.key}`,
        )
        expect(keys).toEqual(["knowledge|o/two", "workspace|settings"])
    })

    it("round trip: an import without a scope writes each entry into the workspace its prefix names and keeps the row identities", async () => {
        const copy = await collectEntries(deploymentOf(true).export({}))
        const target = deploymentOf(false)

        const report = await target.import(entriesFrom(copy), { dryRun: false, mode: "merge" })

        expect(report.outcome).toBe("applied")
        expect(report.sets.map((item) => [item.set, item.created])).toEqual([
            ["knowledge", 3],
            ["workspace", 2],
        ])
        expect((await collectEntries(target.export({}))).map((item) => item.sha256)).toEqual(
            copy.map((item) => item.sha256),
        )
        expect(await target.identityOf("knowledge", `${WS_B}/o/two`)).toMatch(/^row-/u)
        expect(await target.identityOf("knowledge", `${WS_A}/o/two`)).toBeNull()
        const again = await target.import(entriesFrom(copy), { dryRun: false, mode: "merge" })
        expect(again.sets.map((item) => [item.set, item.created, item.updated, item.unchanged])).toEqual([
            ["knowledge", 0, 0, 3],
            ["workspace", 0, 0, 2],
        ])
    })

    it("a key whose prefix names no live workspace, or no workspace at all, is a refused key with its code, not a throw", async () => {
        const stranger = "0c000000-0000-4000-8000-00000000000c"
        const report = await deploymentOf(false).import(
            entriesFrom([
                recordEntry("knowledge", `${stranger}/o/x`, note("x")),
                recordEntry("knowledge", "no-prefix", note("y")),
                recordEntry("knowledge", `${WS_A}/o/ok`, note("ok")),
            ]),
            { dryRun: false, mode: "merge" },
        )
        expect(report.outcome).toBe("partial")
        expect(report.sets[0]).toMatchObject({
            created: 1,
            refused: [
                { key: `${stranger}/o/x`, code: DataRefusalCode.WorkspaceUnknown },
                { key: "no-prefix", code: DataRefusalCode.WorkspaceUnknown },
            ],
        })
    })
})
