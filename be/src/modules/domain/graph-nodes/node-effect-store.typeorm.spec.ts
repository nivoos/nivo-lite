import { Test } from "@nestjs/testing"
import { mockEntityManager } from "@starci/jest-preset"
import { queueQueryBuilders } from "@tests/fixtures/builders/entity-query-builder-fake.builder"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { TypeormNodeEffectStore } from "./node-effect-store.typeorm"
import type { EffectInsert } from "./node-effect-store.port"
import { NodeEffectEntity } from "./persistence/entities"

const WS = "11111111-1111-4111-8111-111111111111"

const build = async () => {
    const em = mockEntityManager()
    const moduleRef = await Test.createTestingModule({
        providers: [TypeormNodeEffectStore, { provide: PRIMARY_ENTITY_MANAGER, useValue: em }],
    }).compile()
    return { store: moduleRef.get(TypeormNodeEffectStore), em }
}

describe("TypeormNodeEffectStore insert", () => {
    it("writes the row through a builder that names its entity, and answers whether this call wrote it", async () => {
        const { store, em } = await build()
        queueQueryBuilders(em, [{ execute: { raw: [{ id: "e1" }] } }, { execute: { raw: [] } }])
        const effect: EffectInsert = {
            effectKey: "k1",
            effectId: "e1",
            subjectEntity: "order",
            subjectId: "o1",
            runId: "r1",
            stepKey: "s1",
            args: { a: 1 },
            facts: null,
        }

        await expect(store.insert(WS, effect)).resolves.toBe(true)
        await expect(store.insert(WS, effect)).resolves.toBe(false)

        expect(em.createQueryBuilder).toHaveBeenCalledWith(NodeEffectEntity, "effect")
    })
})

describe("TypeormNodeEffectStore intent rows (QB-P3 rule I-1)", () => {
    it("resettle moves only a row still of the open kind, and answers whether it moved one", async () => {
        const { store, em } = await build()
        em.update.mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] }).mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] })
        const settled = { subjectEntity: "order", subjectId: "o1", facts: { total: 1 } }

        await expect(store.resettle(WS, "k1", "intent", settled)).resolves.toBe(true)
        await expect(store.resettle(WS, "k1", "intent", settled)).resolves.toBe(false)

        expect(em.update).toHaveBeenCalledWith(
            NodeEffectEntity,
            { workspaceId: WS, effectKey: "k1", subjectEntity: "intent" },
            { subjectEntity: "order", subjectId: "o1", facts: { total: 1 } },
        )
    })

    it("release deletes only a row still of the kind named, and answers whether it deleted one", async () => {
        const { store, em } = await build()
        em.delete.mockResolvedValueOnce({ affected: 1, raw: [] }).mockResolvedValueOnce({ affected: 0, raw: [] })

        await expect(store.release(WS, "k1", "intent")).resolves.toBe(true)
        await expect(store.release(WS, "k1", "intent")).resolves.toBe(false)

        expect(em.delete).toHaveBeenCalledWith(NodeEffectEntity, { workspaceId: WS, effectKey: "k1", subjectEntity: "intent" })
    })
})
