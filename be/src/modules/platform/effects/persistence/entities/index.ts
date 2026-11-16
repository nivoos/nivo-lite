import { EffectLedgerEntity } from "./effect-ledger.entity"

export { EffectLedgerEntity, type EffectKept, type EffectState } from "./effect-ledger.entity"

/** Every entity of the effects capability. */
export const effectsEntities: readonly [typeof EffectLedgerEntity] = [EffectLedgerEntity] as const
