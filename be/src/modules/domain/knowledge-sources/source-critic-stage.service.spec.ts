import { Test } from "@nestjs/testing"
import { mock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { IsNull } from "typeorm"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { KnowledgeSourcesLogEvent } from "./knowledge-sources.log-events"
import { KnowledgeSourceEntity } from "./persistence/entities"
import { SourceCriticStageService } from "./source-critic-stage.service"
import { NOW } from "./source-input.policy"

const WS = "11111111-1111-4111-8111-111111111111"

const build = async (em: MockEntityManager) => {
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            SourceCriticStageService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return { service: moduleRef.get(SourceCriticStageService), logger }
}

describe("SourceCriticStageService enter", () => {
    it("announces nothing when the write supplies no affected count", async () => {
        const em = mockEntityManager({ update: [KnowledgeSourceEntity, {}] })
        const { service } = await build(em)

        await expect(service.enter(WS, "s1")).resolves.toBeUndefined()
    })

    it("gives a ready document with no stage the stage critic and tells every member", async () => {
        const em = mockEntityManager({ update: [KnowledgeSourceEntity, { affected: 1 }] })
        const { service } = await build(em)

        await service.enter(WS, "s1")

        expect(em.update).toHaveBeenCalledWith(
            KnowledgeSourceEntity,
            { id: "s1", workspaceId: WS, status: "ready", stage: IsNull() },
            { stage: "critic", updatedAt: NOW },
        )
    })

    it("says nothing when the document is not ready or already wears a stage", async () => {
        const em = mockEntityManager({ update: [KnowledgeSourceEntity, { affected: 0 }] })
        const { service } = await build(em)

        await service.enter(WS, "s1")
    })
})

describe("SourceCriticStageService leave", () => {
    it("clears the stage only while it is still critic and tells every member", async () => {
        const em = mockEntityManager({ update: [KnowledgeSourceEntity, { affected: 1 }] })
        const { service } = await build(em)

        await service.leave(WS, "s1")

        expect(em.update).toHaveBeenCalledWith(
            KnowledgeSourceEntity,
            { id: "s1", workspaceId: WS, stage: "critic" },
            { stage: null, updatedAt: NOW },
        )
    })

    it("never fails the run that calls it: a write that fails is logged", async () => {
        const em = mockEntityManager()
        em.update.mockRejectedValue(new Error("db"))
        const { service, logger } = await build(em)

        await expect(service.leave(WS, "s1")).resolves.toBeUndefined()

        expect(logger.error).toHaveBeenCalledWith(KnowledgeSourcesLogEvent.ProgressFailed, expect.any(Error), {
            sourceId: "s1",
        })
    })
})

describe("SourceCriticStageService leaveAll", () => {
    it("logs a failed workspace lookup and leaves the calling run alive without writes or announcements", async () => {
        const em = mockEntityManager()
        const failure = new Error("lookup unavailable")
        em.find.mockRejectedValue(failure)
        const { service, logger } = await build(em)

        await expect(service.leaveAll(WS)).resolves.toBeUndefined()

        expect(logger.error).toHaveBeenCalledWith(KnowledgeSourcesLogEvent.ProgressFailed, failure, { workspaceId: WS })
        expect(em.update).not.toHaveBeenCalled()
    })

    it("lets every document still wearing the stage go, each moved where it still wears `critic`", async () => {
        const em = mockEntityManager({
            find: [
                KnowledgeSourceEntity,
                [
                    Object.assign(new KnowledgeSourceEntity(), { id: "s1" }),
                    Object.assign(new KnowledgeSourceEntity(), { id: "s2" }),
                ],
            ],
            update: [KnowledgeSourceEntity, { affected: 1 }],
        })
        const { service } = await build(em)

        await service.leaveAll(WS)

        expect(em.update.mock.calls.map((call) => (call[1] as { id: string }).id)).toEqual(["s1", "s2"])
    })
})
