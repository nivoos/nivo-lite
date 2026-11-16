import { effectsEntities, EffectsService } from "@modules/platform/effects"
import { isRecord } from "@modules/platform/primitives"
import { useTestWorld } from "../../world/use-test-world"

const [EffectLedgerEntity] = effectsEntities

/** NOT RUN by P1-EFFECTS (source only): needs `db/migrations/20261114005000_effect-ledger.sql` applied to the world database. */
describe("effect ledger (lite integration)", () => {
    const world = useTestWorld({ modules: [] })
    beforeAll(() => {
        world.cleanup(async () => {
            await world.db.primary
                .createQueryBuilder(EffectLedgerEntity, "e")
                .delete()
                .where("starts_with(e.key, :prefix)", { prefix: world.prefix })
                .execute()
        })
    })

    it("keeps an act's answer on the row and answers it to a second call without acting", async () => {
        const manager = world.db.primary
        const effects = new EffectsService([manager])
        const key = world.key("effect:send")
        const declaration = { name: "proof.send", settle: "repeatable" } as const
        const act = jest.fn(() => Promise.resolve(41))
        const call = { act, keep: (answer: number) => ({ id: answer }), from: (kept: unknown) => (isRecord(kept) ? Number(kept.id) : 0) }

        await expect(effects.once(key, declaration, call)).resolves.toBe(41)
        await expect(effects.once(key, declaration, call)).resolves.toBe(41)

        expect(act).toHaveBeenCalledTimes(1)
        expect(await manager.findOneByOrFail(EffectLedgerEntity, { key })).toMatchObject({ state: "done", result: { kept: { id: 41 } } })
    })
})
