import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { KnowledgeSourcesService, ProfileSourcesService, type ProfileDocument } from "@modules/domain/knowledge-sources"
import { recordEntry, type JsonValue } from "@modules/integrations/seed"
import { MemoryWorkspaceDirectory, entriesFrom } from "@tests/fixtures/builders/data-stores.builder"
import { DataStoresErrorCode } from "./errors/data-stores.error"
import { DATABASE_CANNOT, knowledgeKeyOf } from "./data-stores.policy"
import { KnowledgeSourcesDoor } from "./knowledge-sources.adapter"
import { WorkspaceDatabaseStore } from "./workspace-database.adapter"

const WORKSPACE = { id: "ws-1", ownerId: "owner-1" }

/** Makes the documents the knowledge service lists: later documents have the later creation instant and the next id. */
const documentMaker = (): ((over: Partial<ProfileDocument>) => ProfileDocument) => {
    let clock = 0
    return (over) => {
        clock += 1
        return {
            id: `src-${String(clock)}`,
            origin: "seed:nivo",
            title: "Alpha",
            topic: "t",
            module: null,
            visibility: "internal",
            content: "a",
            createdAt: new Date(clock),
            ...over,
        }
    }
}

const key = (title: string, origin = "seed:nivo"): string => knowledgeKeyOf(origin, title)

const build = async (
    rows: Array<ProfileDocument>,
    document: (over: Partial<ProfileDocument>) => ProfileDocument,
    withSources = true,
) => {
    const profiles = mock<ProfileSourcesService>()
    profiles.textDocuments.mockImplementation(() => Promise.resolve([...rows]))
    profiles.keep.mockImplementation((input) => {
        const found = rows.find((held) => held.origin === input.origin && held.title === input.title)
        if (found === undefined) {
            rows.push(
                document({
                    origin: input.origin,
                    title: input.title,
                    topic: input.topic,
                    module: input.module,
                    visibility: input.visibility,
                    content: input.content,
                }),
            )
            return Promise.resolve("inserted")
        }
        if (found.content === input.content) return Promise.resolve("unchanged")
        Object.assign(found, {
            content: input.content,
            topic: input.topic,
            module: input.module,
            visibility: input.visibility,
        })
        return Promise.resolve("requeued")
    })
    const sources = mock<KnowledgeSourcesService>()
    sources.updateSource.mockImplementation((_userId, _workspaceId, input) => {
        const found = rows.find((held) => held.id === input.sourceId)
        if (found !== undefined)
            Object.assign(found, {
                topic: input.topic ?? found.topic,
                module: input.module === "" ? null : (input.module ?? found.module),
                visibility: input.visibility ?? found.visibility,
            })
        return Promise.resolve(null)
    })
    const moduleRef = await Test.createTestingModule({
        providers: [
            KnowledgeSourcesDoor,
            { provide: ProfileSourcesService, useValue: profiles },
            ...(withSources ? [{ provide: KnowledgeSourcesService, useValue: sources }] : []),
        ],
    }).compile()
    const door = moduleRef.get(KnowledgeSourcesDoor)
    const store = new WorkspaceDatabaseStore(
        new MemoryWorkspaceDirectory({ "nivo-web": WORKSPACE }),
        [door],
        DATABASE_CANNOT,
        { workspace: "nivo-web" },
    )
    return { door, store, profiles, sources }
}

describe("KnowledgeSourcesDoor (set knowledge)", () => {
    let document = documentMaker()
    beforeEach(() => {
        document = documentMaker()
    })

    it("lists the documents as records without ids, the oldest row of a key once, and leaves out the parts of a long document", async () => {
        const rows = [
            document({ title: "Alpha", content: "first" }),
            document({ title: "Alpha", content: "second copy" }),
            document({ title: "Beta", topic: null, module: "sales", visibility: "public" }),
            document({ title: "Part", origin: "part:src-9" }),
        ]
        const { door } = await build(rows, document)

        const listed = await door.list(WORKSPACE)

        expect(listed.map((item) => item.key)).toEqual([key("Alpha"), key("Beta")])
        expect(listed[0]).toMatchObject({
            id: "src-1",
            record: { content: "first", module: null, topic: "t", visibility: "internal" },
        })
        expect(listed[1]?.record).toEqual({ content: "a", module: "sales", topic: "", visibility: "public" })
        expect(JSON.stringify(listed)).not.toContain("ws-1")
    })

    it("creates a document through keep with the workspace owner as the creator, and answers its new id", async () => {
        const rows: Array<ProfileDocument> = []
        const { store, profiles } = await build(rows, document)

        const report = await store.import(
            entriesFrom([
                recordEntry("knowledge", key("New"), {
                    content: "n",
                    module: "sales",
                    topic: "t",
                    visibility: "public",
                }),
            ]),
            {
                dryRun: false,
                mode: "merge",
            },
        )

        expect(report.sets[0]).toMatchObject({ created: 1 })
        expect(profiles.keep).toHaveBeenCalledWith({
            workspaceId: "ws-1",
            ownerId: "owner-1",
            origin: "seed:nivo",
            title: "New",
            topic: "t",
            module: "sales",
            visibility: "public",
            content: "n",
        })
        expect(await store.identityOf("knowledge", key("New"))).toBe(rows[0]?.id)
    })

    it("updates a changed text in place through keep: the row keeps its id, and a second import changes nothing", async () => {
        const rows = [document({ title: "Alpha", content: "a" })]
        const { store } = await build(rows, document)
        const id = await store.identityOf("knowledge", key("Alpha"))
        const wanted = recordEntry("knowledge", key("Alpha"), {
            content: "changed",
            module: null,
            topic: "t",
            visibility: "internal",
        })

        const first = await store.import(entriesFrom([wanted]), { dryRun: false, mode: "merge" })

        expect(first.sets[0]).toMatchObject({ updated: 1, created: 0 })
        expect(await store.identityOf("knowledge", key("Alpha"))).toBe(id)
        expect(rows).toHaveLength(1)
        expect((await store.import(entriesFrom([wanted]), { dryRun: false, mode: "merge" })).outcome).toBe("unchanged")
    })
})

describe("KnowledgeSourcesDoor (set knowledge): the metadata and the refusals", () => {
    let document = documentMaker()
    beforeEach(() => {
        document = documentMaker()
    })

    it("changes topic, module or visibility alone through the knowledge service, which moves the passages with it", async () => {
        const rows = [document({ title: "Alpha", content: "a", topic: "t", module: null, visibility: "internal" })]
        const { store, profiles, sources } = await build(rows, document)
        const wanted = recordEntry("knowledge", key("Alpha"), {
            content: "a",
            module: "sales",
            topic: "other",
            visibility: "public",
        })

        await store.import(entriesFrom([wanted]), { dryRun: false, mode: "merge" })

        expect(profiles.keep).not.toHaveBeenCalled()
        expect(sources.updateSource).toHaveBeenCalledWith("owner-1", "ws-1", {
            sourceId: rows[0]?.id ?? "",
            topic: "other",
            module: "sales",
            visibility: "public",
        })
        expect(rows[0]).toMatchObject({ topic: "other", module: "sales", visibility: "public" })
        expect((await store.import(entriesFrom([wanted]), { dryRun: false, mode: "merge" })).outcome).toBe("unchanged")
    })

    it("refuses a metadata-only change where the app has no knowledge service, and says so by code", async () => {
        const rows = [document({ title: "Alpha", content: "a" })]
        const { store } = await build(rows, document, false)

        const report = await store.import(
            entriesFrom([
                recordEntry("knowledge", key("Alpha"), {
                    content: "a",
                    module: null,
                    topic: "t",
                    visibility: "public",
                }),
            ]),
            {
                dryRun: false,
                mode: "merge",
            },
        )

        expect(report.outcome).toBe("partial")
        expect(report.sets[0]?.refused).toEqual([{ key: key("Alpha"), code: DataStoresErrorCode.KnowledgeMetaDoor }])
        expect(rows[0]?.visibility).toBe("internal")
    })

    it("refuses a malformed key or record by code and writes nothing", async () => {
        const { store, profiles } = await build([], document)
        const bad: JsonValue = { content: 5, module: null, topic: "", visibility: "internal" }
        const worse: JsonValue = { content: "x", module: null, topic: "", visibility: "secret" }

        const report = await store.import(
            entriesFrom([
                recordEntry("knowledge", "no-slash", { content: "x", module: null, topic: "", visibility: "internal" }),
                recordEntry("knowledge", key("Bad"), bad),
                recordEntry("knowledge", key("Worse"), worse),
                recordEntry("knowledge", key("Array"), [1]),
            ]),
            { dryRun: false, mode: "merge" },
        )

        expect(report.sets[0]?.refused.map((item) => item.code)).toEqual(
            Array(4).fill(DataStoresErrorCode.RecordInvalid),
        )
        expect(profiles.keep).not.toHaveBeenCalled()
    })

    it("has no removing door: documents leave through the knowledge page, never through a mirror", async () => {
        const { door } = await build([], document)

        expect("remove" in door).toBe(false)
    })
})
