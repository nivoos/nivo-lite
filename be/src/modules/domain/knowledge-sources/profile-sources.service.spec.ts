import { row } from "@tests/fixtures/builders/knowledge-sources.builder"
import { Test } from "@nestjs/testing"
import { FakeClock, builder, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { MoreThan } from "typeorm"
import { KnowledgeQueue } from "@modules/queues/knowledge"
import { KnowledgeSourcesErrorCode } from "./errors/knowledge-sources.error"
import type { ProfileSourceInput } from "./knowledge-sources.contracts"
import { KnowledgeSourceEntity } from "./persistence/entities"
import { ProfileSourcesService } from "./profile-sources.service"

const objectLike = (shape: Record<string, unknown>): unknown => expect.objectContaining(shape)
const anyOf = (type: unknown): unknown => expect.any(type)

const WS = "11111111-1111-4111-8111-111111111111"
const AT = "2026-10-12T10:00:00.000Z"
/** The scoped manager a transaction body receives: the queue job is written through it, not the injected manager. */
const TX_MANAGER = objectLike({ transaction: anyOf(Function) })
const sourceOf = builder<ProfileSourceInput>({
    workspaceId: WS,
    ownerId: "owner-1",
    origin: "seed:demo",
    title: "Rooms",
    topic: "Rooms",
    module: null,
    visibility: "public",
    content: "# Rooms",
})

/** The lookup of the kept document: by origin and title, oldest first, locked for the run. */
const FIND_PROFILE = {
    select: { id: true, content: true },
    where: { workspaceId: WS, origin: "seed:demo", title: "Rooms" },
    order: { createdAt: "ASC" },
    lock: { mode: "pessimistic_write" },
}
const found = builder<KnowledgeSourceEntity>(row)
const KEY = { id: "s1", workspaceId: WS }
/** An update the service wrote: the entity, the key of the document and the changes with the instant of the change. */
const updateOf = (changes: object): [typeof KnowledgeSourceEntity, object, object] => [
    KnowledgeSourceEntity,
    KEY,
    { ...changes, updatedAt: anyOf(Function) },
]

const build = async (em: MockEntityManager) => {
    const queue = mock<KnowledgeQueue>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            ProfileSourcesService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: CLOCK, useValue: new FakeClock(AT) },
            { provide: KnowledgeQueue, useValue: queue },
        ],
    }).compile()
    return { service: moduleRef.get(ProfileSourcesService), queue }
}

describe("ProfileSourcesService", () => {
    describe("keep a new or unchanged document", () => {
        it("inserts a new text source as the owner and queues its indexing in the same transaction", async () => {
            const tx = fakeTransaction(
                mockEntityManager({
                    findOne: [KnowledgeSourceEntity, null],
                    insert: [KnowledgeSourceEntity, { identifiers: [{ id: "s1" }] }],
                }),
            )
            const { service, queue } = await build(tx.em)

            await expect(service.keep(sourceOf({ module: "booking" }))).resolves.toBe("inserted")
            expect(tx.em.findOne).toHaveBeenCalledWith(KnowledgeSourceEntity, FIND_PROFILE)
            expect(tx.em.insert).toHaveBeenCalledWith(KnowledgeSourceEntity, {
                workspaceId: WS,
                module: "booking",
                installationId: null,
                kind: "text",
                topic: "Rooms",
                tags: [],
                visibility: "public",
                title: "Rooms",
                content: "# Rooms",
                status: "queued",
                progress: 0,
                storagePath: null,
                sourceUrl: null,
                origin: "seed:demo",
                createdBy: "owner-1",
            })
            expect(queue.enqueueIndex).toHaveBeenCalledWith({ sourceId: "s1", workspaceId: WS }, TX_MANAGER)
            expect(queue.enqueueIndex.mock.calls[0]?.[1]).not.toBe(tx.em)
            expect(tx.commits).toBe(1)
        })

        it("leaves a document whose text is unchanged alone", async () => {
            const tx = fakeTransaction(
                mockEntityManager({
                    findOne: [KnowledgeSourceEntity, Object.assign(found(), { content: "# Rooms" })],
                }),
            )
            const { service, queue } = await build(tx.em)

            await expect(service.keep(sourceOf())).resolves.toBe("unchanged")
            expect(tx.em.findOne).toHaveBeenCalledTimes(1)
            expect(queue.enqueueIndex).not.toHaveBeenCalled()
        })
    })
})

describe("ProfileSourcesService", () => {
    describe("keep a changed document", () => {
        it("queues a changed text again with its metadata and clears the module of a shared document", async () => {
            const tx = fakeTransaction(
                mockEntityManager({
                    findOne: [KnowledgeSourceEntity, Object.assign(found(), { content: "" })],
                    update: [KnowledgeSourceEntity, { affected: 1 }],
                }),
            )
            const { service, queue } = await build(tx.em)

            await expect(service.keep(sourceOf({ visibility: "internal" }))).resolves.toBe("requeued")
            expect(tx.em.update.mock.calls).toEqual([
                updateOf({ status: "queued", progress: 0, error: null, content: "# Rooms" }),
                updateOf({ topic: "Rooms", module: null, visibility: "internal" }),
            ])
            expect(queue.enqueueIndex).toHaveBeenCalledWith(
                { sourceId: "s1", workspaceId: WS },
                TX_MANAGER,
                new Date(AT).getTime(),
            )
        })

        it("keeps the module of a module document when it is queued again", async () => {
            const tx = fakeTransaction(
                mockEntityManager({
                    findOne: [KnowledgeSourceEntity, Object.assign(found(), { content: "old" })],
                    update: [KnowledgeSourceEntity, { affected: 1 }],
                }),
            )
            const { service } = await build(tx.em)

            await expect(service.keep(sourceOf({ module: "accounting" }))).resolves.toBe("requeued")
            expect(tx.em.update).toHaveBeenLastCalledWith(
                ...updateOf({ topic: "Rooms", module: "accounting", visibility: "public" }),
            )
        })

        it("rolls back without queueing when the insert answered no row", async () => {
            const tx = fakeTransaction(
                mockEntityManager({
                    findOne: [KnowledgeSourceEntity, null],
                    insert: [KnowledgeSourceEntity, { identifiers: [] }],
                }),
            )
            const { service, queue } = await build(tx.em)

            await expect(service.keep(sourceOf())).rejects.toMatchObject({
                code: KnowledgeSourcesErrorCode.SourceNotFound,
            })
            expect(queue.enqueueIndex).not.toHaveBeenCalled()
            expect(tx.rollbacks).toBe(1)
        })
    })
})

describe("ProfileSourcesService: the text documents of a workspace", () => {
    /** One row of the knowledge table as the listing reads it: its id, its title, when it was created and the origin it carries (none for an upload). */
    const documentRow = (
        id: string,
        title: string,
        created = 1000,
        origin: string | null = "seed:demo",
    ): KnowledgeSourceEntity =>
        Object.assign(found(), {
            id,
            title,
            origin,
            createdAt: new Date(created),
            content: "# Rooms",
            topic: "Rooms",
            module: null,
            visibility: "public",
        })

    it("lists the documents that carry an origin, oldest first, as documents with their origin set", async () => {
        const em = mockEntityManager({
            find: [
                KnowledgeSourceEntity,
                [
                    documentRow("b", "Beta", 3000),
                    documentRow("a", "Alpha", 2000),
                    documentRow("n", "Upload", 1000, null),
                ],
            ],
        })
        const { service } = await build(em)

        const documents = await service.textDocuments(WS)

        expect(documents.map((document) => [document.id, document.title, document.origin])).toEqual([
            ["a", "Alpha", "seed:demo"],
            ["b", "Beta", "seed:demo"],
        ])
        expect(em.find).toHaveBeenCalledWith(
            KnowledgeSourceEntity,
            objectLike({ where: objectLike({ workspaceId: WS, kind: "text" }), order: { id: "ASC" }, take: 500 }),
        )
    })

    it("reads the next page after the last id of a full page, until a page is short", async () => {
        const full = Array.from({ length: 500 }, (_, index) =>
            documentRow(`id-${String(index).padStart(3, "0")}`, `T${String(index)}`),
        )
        const em = mockEntityManager({
            find: [
                [KnowledgeSourceEntity, full],
                [KnowledgeSourceEntity, [documentRow("id-999", "Last")]],
            ],
        })
        const { service } = await build(em)

        const documents = await service.textDocuments(WS)

        expect(documents).toHaveLength(501)
        expect(em.find).toHaveBeenCalledTimes(2)
        expect(em.find.mock.calls[1]?.[1]).toMatchObject({ where: { id: MoreThan("id-499") } })
    })
})
