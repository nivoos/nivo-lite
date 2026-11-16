import { Test } from "@nestjs/testing"
import { builder, mockEntityManager, type MockEntityManager } from "@starci/jest-preset"
import { IsNull } from "typeorm"
import { WorkspaceEntity } from "@modules/domain/workspaces"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { WorkspaceDirectoryService } from "./workspace-directory.service"

const workspaceOf = builder<WorkspaceEntity>(
    Object.assign(new WorkspaceEntity(), { id: "ws-x", ownerId: "owner-x", name: "N", enterpriseKey: null }),
)

const build = async (em: MockEntityManager): Promise<WorkspaceDirectoryService> => {
    const moduleRef = await Test.createTestingModule({
        providers: [WorkspaceDirectoryService, { provide: PRIMARY_ENTITY_MANAGER, useValue: em }],
    }).compile()
    return moduleRef.get(WorkspaceDirectoryService)
}

describe("WorkspaceDirectoryService", () => {
    it("finds a workspace by its enterprise identifier first, among the live workspaces", async () => {
        const em = mockEntityManager({
            findOne: [WorkspaceEntity, workspaceOf({ id: "ws-1", ownerId: "o-1", enterpriseKey: "nivo-web" })],
        })
        const directory = await build(em)

        expect(await directory.resolve("nivo-web")).toEqual({ id: "ws-1", ownerId: "o-1" })
        expect(em.findOne).toHaveBeenCalledWith(
            WorkspaceEntity,
            expect.objectContaining({ where: { enterpriseKey: "nivo-web", deletedAt: IsNull() } }),
        )
    })

    it("falls back to the name when exactly one live workspace carries it", async () => {
        const em = mockEntityManager({
            findOne: [WorkspaceEntity, null],
            find: [WorkspaceEntity, [workspaceOf({ id: "ws-1", ownerId: "o-1", name: "Flower shop" })]],
        })
        const directory = await build(em)

        expect(await directory.resolve("Flower shop")).toEqual({ id: "ws-1", ownerId: "o-1" })
        expect(em.find).toHaveBeenCalledWith(
            WorkspaceEntity,
            expect.objectContaining({ where: { name: "Flower shop", deletedAt: IsNull() }, take: 2 }),
        )
    })

    it("answers null for a name two live workspaces share", async () => {
        const em = mockEntityManager({
            findOne: [WorkspaceEntity, null],
            find: [
                WorkspaceEntity,
                [workspaceOf({ id: "ws-1", name: "Twin" }), workspaceOf({ id: "ws-2", name: "Twin" })],
            ],
        })
        const directory = await build(em)

        expect(await directory.resolve("Twin")).toBeNull()
    })

    it("answers null for an unknown key", async () => {
        const directory = await build(
            mockEntityManager({ findOne: [WorkspaceEntity, null], find: [WorkspaceEntity, []] }),
        )

        expect(await directory.resolve("nobody")).toBeNull()
    })

    it("lists every live workspace by id order, and none for an environment without a workspace", async () => {
        const em = mockEntityManager({
            find: [WorkspaceEntity, [workspaceOf({ id: "ws-1", ownerId: "o-1" }), workspaceOf({ id: "ws-2", ownerId: "o-2" })]],
        })
        const directory = await build(em)

        expect(await directory.all()).toEqual([
            { id: "ws-1", ownerId: "o-1" },
            { id: "ws-2", ownerId: "o-2" },
        ])
        expect(em.find).toHaveBeenCalledWith(
            WorkspaceEntity,
            expect.objectContaining({ where: { deletedAt: IsNull() }, order: { id: "ASC" }, take: 500 }),
        )
        expect(await (await build(mockEntityManager({ find: [WorkspaceEntity, []] }))).all()).toEqual([])
    })

    it("finds a live workspace by its id, and never asks the database about a text that is no id", async () => {
        const id = "0a000000-0000-4000-8000-00000000000a"
        const em = mockEntityManager({ findOne: [WorkspaceEntity, workspaceOf({ id, ownerId: "o-1" })] })
        const directory = await build(em)

        expect(await directory.byId(id)).toEqual({ id, ownerId: "o-1" })
        expect(await directory.byId("not-an-id")).toBeNull()
        expect(em.findOne).toHaveBeenCalledTimes(1)
    })
})
