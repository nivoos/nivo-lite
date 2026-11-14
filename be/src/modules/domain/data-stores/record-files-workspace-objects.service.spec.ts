import { Test } from "@nestjs/testing"
import type { EntityDefinition } from "@nivo-lite/agent-sdk/entity"
import type { ListPage, PageRow } from "@nivo-lite/agent-sdk/entity/port"
import { mock } from "@starci/jest-preset"
import { EntityEngineService, type ScopedTx } from "@modules/domain/entity-engine"
import {
    OBJECT_STORAGE_ERROR_CODES,
    STORAGE_FILES,
    STORAGE_OBJECTS,
    type StorageFilesPort,
    type StorageObjectsPort,
} from "@modules/integrations/object-storage"
import { ok, refused } from "@modules/platform/primitives"
import { DataStoresErrorCode } from "./errors/data-stores.error"
import { RecordFilesWorkspaceObjects } from "./record-files-workspace-objects.service"

const NOT_FOUND = OBJECT_STORAGE_ERROR_CODES.ObjectNotFound
const UNAVAILABLE = OBJECT_STORAGE_ERROR_CODES.Unavailable

/** The records the fake engine pages: the `data` of each (the file field of a video project). */
type Records = ReadonlyArray<Readonly<Record<string, unknown>>>

/** One stored object: its bytes and content type. */
interface Stored {
    bytes: Uint8Array
    mime: string
}

/** The two declared entities of the fake catalog: one with a `file` field, one without. */
const catalogOf = (): Map<string, EntityDefinition> => {
    const withFile = mock<EntityDefinition>({
        name: "video.project",
        fields: { cover: { kind: "file", many: false }, title: { kind: "text" } },
    })
    const plain = mock<EntityDefinition>({ name: "contact.person", fields: { name: { kind: "text" } } })
    return new Map([
        [withFile.name, withFile],
        [plain.name, plain],
    ])
}

/** The records of the entity as pages of `size` rows, the cursor being the offset of the next page. */
const pageOf = (records: Records, after: string | undefined, size: number): ListPage => {
    const start = after === undefined ? 0 : Number(after)
    const rows = records
        .slice(start, start + size)
        .map((data, index) => mock<PageRow>({ row: { id: `rec-${String(start + index)}`, data } }))
    return { rows, next: start + size < records.length ? String(start + size) : null }
}

const build = async (
    objects: Record<string, Stored>,
    records: Records = [],
    staged: ReadonlyArray<string> | null = [],
) => {
    const calls: Array<string> = []
    const down = { value: false }
    const files = mock<StorageFilesPort>()
    files.read.mockImplementation((key) => {
        calls.push(`read ${key}`)
        const found = objects[key]
        if (down.value) return Promise.resolve(refused(UNAVAILABLE))
        return Promise.resolve(
            found === undefined ? refused(NOT_FOUND) : ok({ bytes: found.bytes, contentType: found.mime }),
        )
    })
    files.head.mockImplementation((key) => {
        const found = objects[key]
        if (down.value) return Promise.resolve(refused(UNAVAILABLE))
        return Promise.resolve(
            found === undefined ? refused(NOT_FOUND) : ok({ size: found.bytes.byteLength, mime: found.mime }),
        )
    })
    files.write.mockImplementation((key, bytes, mime) => {
        calls.push(`write ${key}`)
        if (down.value) return Promise.resolve(refused(UNAVAILABLE))
        objects[key] = { bytes, mime }
        return Promise.resolve(ok(null))
    })
    files.remove.mockImplementation((key) => {
        calls.push(`remove ${key}`)
        Reflect.deleteProperty(objects, key)
        return Promise.resolve(ok(null))
    })
    const listing = mock<StorageObjectsPort>()
    listing.list.mockImplementation((bucket, prefix) => {
        calls.push(`list ${bucket} ${prefix}`)
        return Promise.resolve(
            staged === null ? refused(UNAVAILABLE) : ok(staged.map((name) => ({ name, createdAt: null }))),
        )
    })
    const engine = mock<EntityEngineService>({ catalog: catalogOf() })
    engine.scoped.mockImplementation((workspaceId, work) => work(mock<ScopedTx>({ workspaceId })))
    engine.list.mockImplementation((tx, query) =>
        Promise.resolve(
            tx.workspaceId === "ws-1" && query.from === "video.project"
                ? pageOf(records, query.page.after, 2)
                : { rows: [], next: null },
        ),
    )
    const moduleRef = await Test.createTestingModule({
        providers: [
            RecordFilesWorkspaceObjects,
            { provide: STORAGE_FILES, useValue: files },
            { provide: STORAGE_OBJECTS, useValue: listing },
            { provide: EntityEngineService, useValue: engine },
        ],
    }).compile()
    return { service: moduleRef.get(RecordFilesWorkspaceObjects), calls, down, engine }
}

const ref = (key: string): Record<string, unknown> => ({ key, mime: "image/png", size: 3, name: "c.png" })

describe("RecordFilesWorkspaceObjects", () => {
    it("finds the keys from the file fields of the workspace records and from its staged folder, relative to the prefix", async () => {
        const t = await build(
            {},
            [
                { title: "a", cover: ref("ws-1/video.project/rec-1/cover/obj-1") },
                { title: "b", cover: ref("ws-2/video.project/rec-2/cover/obj-2") },
                { title: "no file" },
            ],
            ["obj-9"],
        )

        const keys = await t.service.keys("ws-1")

        expect([...keys].sort()).toEqual(["staged/obj-9", "video.project/rec-1/cover/obj-1"])
        expect(t.calls).toEqual(["list records ws-1/staged"])
    })

    it("reads every page of a type that holds files, asking only for its file fields, and none for a type without a file field", async () => {
        const records = ["a", "b", "c", "d", "e"].map((name) => ({ cover: ref(`ws-1/video.project/${name}/cover/o`) }))
        const t = await build({}, records)

        const keys = await t.service.keys("ws-1")

        expect(keys).toHaveLength(5)
        expect(t.engine.list).toHaveBeenCalledTimes(3)
        expect(t.engine.list).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ from: "video.project", select: ["cover"] }),
            "ws-1/video.project",
        )
        expect(t.engine.list).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ from: "contact.person" }),
            expect.anything(),
        )
    })

    it("reads and writes under the workspace prefix and answers null for an absent object", async () => {
        const t = await build({ "ws-1/a/b": { bytes: new Uint8Array([1]), mime: "text/plain" } })

        expect(await t.service.read("ws-1", "a/b")).toEqual({ bytes: new Uint8Array([1]), mime: "text/plain" })
        expect(await t.service.read("ws-1", "missing")).toBeNull()
        expect(await t.service.exists("ws-1", "a/b")).toBe(true)
        expect(await t.service.exists("ws-1", "missing")).toBe(false)
        await t.service.write("ws-1", "n/new", { bytes: new Uint8Array([2]), mime: "image/png" })
        await t.service.remove("ws-1", "a/b")
        expect(t.calls.filter((call) => !call.startsWith("read"))).toEqual(["write ws-1/n/new", "remove ws-1/a/b"])
    })

    it("throws, never answers absent, when the store does not answer", async () => {
        const t = await build({})
        t.down.value = true

        await expect(t.service.read("ws-1", "a")).rejects.toMatchObject({
            code: DataStoresErrorCode.StorageUnavailable,
        })
        await expect(t.service.exists("ws-1", "a")).rejects.toMatchObject({
            code: DataStoresErrorCode.StorageUnavailable,
        })
        await expect(t.service.write("ws-1", "a", { bytes: new Uint8Array(), mime: "x/y" })).rejects.toMatchObject({
            code: DataStoresErrorCode.StorageUnavailable,
        })
    })

    it("throws when the staged folder cannot be listed", async () => {
        const t = await build({}, [], null)

        await expect(t.service.keys("ws-1")).rejects.toMatchObject({ code: DataStoresErrorCode.StorageUnavailable })
    })
})
