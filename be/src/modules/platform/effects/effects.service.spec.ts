import { mockEntityManager } from "@starci/jest-preset"
import { Test } from "@nestjs/testing"
import type { JobEffectDeclaration } from "@modules/platform/jobs"
import { classifyFailure } from "@modules/platform/queue"
import { DomainError } from "@modules/platform/errors"
import { isRecord } from "@modules/platform/primitives"
import { randomBytes } from "node:crypto"
import { Secret } from "@modules/platform/config"
import { EFFECTS_MANAGERS, EFFECTS_OPTIONS } from "./effects.decorators"
import type { EffectCallKept, EffectCallPlain, EffectLedger, EffectResult } from "./effects.port"
import { EffectLedgerRules, EffectsService } from "./effects.service"
import { EffectsErrorCode } from "./errors/effects.error"
import { EffectLedgerEntity, type EffectKept, type EffectState } from "./persistence/entities"

/** A coded error of some other capability, which an act may throw. */
class ProviderError extends DomainError<"PROVIDER_REFUSED"> {}

const REPEATABLE: JobEffectDeclaration = { name: "provider.send", settle: "repeatable" }
const CONFIRM: JobEffectDeclaration = { name: "provider.charge", settle: "confirm" }
const PERSON: JobEffectDeclaration = { name: "provider.refund", settle: "person" }
const KEY = "job-1:send"

/** The settled columns a done row is written with. */
const anyFunction: unknown = expect.any(Function)
const doneWith = (kept: EffectKept | null) => ({ state: "done", result: kept, settledAt: anyFunction })

/** The row of the ledger a spec finds for the key. */
const ledgerRow = (state: EffectState, result: EffectKept | null = null): EffectLedgerEntity => {
    const row = new EffectLedgerEntity()
    row.key = KEY
    row.name = "provider.send"
    row.state = state
    row.result = result
    return row
}

/** The service over a strict manager double that finds `found` for the key. */
const build = async (found: EffectLedgerEntity | null = null) => {
    const manager = mockEntityManager({
        findOne: [EffectLedgerEntity, found],
        insert: [EffectLedgerEntity, {}],
        update: [EffectLedgerEntity, { affected: 1 }],
        delete: [EffectLedgerEntity, {}],
    })
    const moduleRef = await Test.createTestingModule({
        providers: [EffectsService, { provide: EFFECTS_MANAGERS, useValue: [manager] }],
    }).compile()
    return { effects: moduleRef.get(EffectsService), manager }
}

const kept = (act: () => Promise<number>): EffectCallKept<number> => ({
    act,
    keep: (answer) => ({ id: answer }),
    from: (value: EffectResult) => (isRecord(value) ? Number(value.id) : 0),
})
const plain = (act: () => Promise<unknown>): EffectCallPlain => ({ act })

describe("EffectsService.once: a new or settled key", () => {
    it("commits the intent on its own statement before the act, then settles the row with the kept answer", async () => {
        const { effects, manager } = await build()
        const act = jest.fn(() => {
            expect(manager.insert).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY, name: "provider.send", state: "intent" })
            expect(manager.update).not.toHaveBeenCalled()
            return Promise.resolve(7)
        })

        await expect(effects.once(KEY, REPEATABLE, kept(act))).resolves.toBe(7)

        expect(act).toHaveBeenCalledTimes(1)
        expect(manager.update).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY }, doneWith({ kept: { id: 7 } }))
    })

    it("settles an act that keeps nothing as done with no result", async () => {
        const { effects, manager } = await build()

        await expect(effects.once(KEY, PERSON, plain(() => Promise.resolve(1)))).resolves.toBeUndefined()

        expect(manager.update).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY }, doneWith(null))
    })

    it("answers a key settled with a kept result without acting", async () => {
        const { effects, manager } = await build(ledgerRow("done", { kept: { id: 9 } }))
        const act = jest.fn(() => Promise.resolve(1))

        await expect(effects.once(KEY, PERSON, kept(act))).resolves.toBe(9)

        expect(act).not.toHaveBeenCalled()
        expect(manager.update).not.toHaveBeenCalled()
        expect(manager.insert).not.toHaveBeenCalled()
    })

    it("acts again for a settled repeatable key that kept nothing, the row an intent again first", async () => {
        const { effects, manager } = await build(ledgerRow("done"))
        const act = jest.fn(() => {
            expect(manager.update).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY }, { state: "intent", result: null, settledAt: null })
            return Promise.resolve(2)
        })

        await expect(effects.once(KEY, REPEATABLE, kept(act))).resolves.toBe(2)

        expect(act).toHaveBeenCalledTimes(1)
        expect(manager.update).toHaveBeenLastCalledWith(EffectLedgerEntity, { key: KEY }, doneWith({ kept: { id: 2 } }))
    })

    it("does not act again for a settled key of a call that keeps nothing: the act happened and no answer is needed", async () => {
        const { effects, manager } = await build(ledgerRow("done"))
        const act = jest.fn(() => Promise.resolve(1))

        await expect(effects.once(KEY, PERSON, plain(act))).resolves.toBeUndefined()

        expect(act).not.toHaveBeenCalled()
        expect(manager.update).not.toHaveBeenCalled()
    })

})

describe("EffectsService.once: a lost act", () => {
    it("acts again under the same key for an intent of a repeatable effect", async () => {
        const { effects, manager } = await build(ledgerRow("intent"))
        const act = jest.fn(() => Promise.resolve(3))

        await expect(effects.once(KEY, REPEATABLE, kept(act))).resolves.toBe(3)

        expect(act).toHaveBeenCalledTimes(1)
        expect(manager.insert).not.toHaveBeenCalled()
        expect(manager.update).toHaveBeenLastCalledWith(EffectLedgerEntity, { key: KEY }, doneWith({ kept: { id: 3 } }))
    })

    it("settles a lost confirm effect that happened with the answer of its read, without acting", async () => {
        const { effects, manager } = await build(ledgerRow("intent"))
        const act = jest.fn(() => Promise.resolve(1))

        await expect(effects.once(KEY, CONFIRM, { ...kept(act), confirm: () => Promise.resolve(5) })).resolves.toBe(5)

        expect(act).not.toHaveBeenCalled()
        expect(manager.update).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY }, doneWith({ kept: { id: 5 } }))
    })

    it("settles a lost confirm effect that keeps nothing when its read says it happened", async () => {
        const { effects, manager } = await build(ledgerRow("intent"))
        const act = jest.fn(() => Promise.resolve(1))

        await expect(effects.once(KEY, CONFIRM, { ...plain(act), confirm: () => Promise.resolve(true) })).resolves.toBeUndefined()

        expect(act).not.toHaveBeenCalled()
        expect(manager.update).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY }, doneWith(null))
    })

    it("marks a lost confirm effect that did not happen as unknown and throws OUTCOME_UNKNOWN, without acting", async () => {
        const { effects, manager } = await build(ledgerRow("intent"))
        const act = jest.fn(() => Promise.resolve(1))

        await expect(effects.once(KEY, CONFIRM, { ...kept(act), confirm: () => Promise.resolve(null) })).rejects.toMatchObject({
            code: EffectsErrorCode.OutcomeUnknown,
        })

        expect(act).not.toHaveBeenCalled()
        expect(manager.update).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY }, { state: "unknown" })
    })

    it("refuses a lost confirm effect whose call has no confirm, and changes nothing", async () => {
        const { effects, manager } = await build(ledgerRow("intent"))

        await expect(effects.once(KEY, CONFIRM, kept(() => Promise.resolve(1)))).rejects.toMatchObject({
            code: EffectsErrorCode.ConfirmMissing,
        })

        expect(manager.update).not.toHaveBeenCalled()
    })

    it.each(["intent", "unknown"] as const)("marks a lost person effect (%s) unknown at once and throws, without acting", async (state) => {
        const { effects, manager } = await build(ledgerRow(state))
        const act = jest.fn(() => Promise.resolve(1))

        await expect(effects.once(KEY, PERSON, kept(act))).rejects.toMatchObject({ code: EffectsErrorCode.OutcomeUnknown })

        expect(act).not.toHaveBeenCalled()
        expect(manager.update).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY }, { state: "unknown" })
    })

})

describe("EffectsService.once: an act that throws", () => {
    it("releases the intent when the act throws", async () => {
        const { effects, manager } = await build()
        const refusal = new ProviderError({ code: "PROVIDER_REFUSED" })

        await expect(effects.once(KEY, REPEATABLE, plain(jest.fn().mockRejectedValue(refusal)))).rejects.toBe(refusal)

        expect(manager.delete).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY })
        expect(manager.update).not.toHaveBeenCalled()
    })

    it("keeps the intent as unknown when the act throws a coded error with outcomeUnknown 1", async () => {
        const { effects, manager } = await build()
        const lost = new ProviderError({ code: "PROVIDER_REFUSED", params: { outcomeUnknown: 1 } })

        await expect(effects.once(KEY, PERSON, plain(jest.fn().mockRejectedValue(lost)))).rejects.toBe(lost)

        expect(manager.update).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY }, { state: "unknown" })
        expect(manager.delete).not.toHaveBeenCalled()
    })

    it("keeps the intent as unknown when outcomeUnknown 1 is carried by a cause of the thrown error", async () => {
        const { effects, manager } = await build()
        const lost = new ProviderError({ code: "PROVIDER_REFUSED", params: { outcomeUnknown: 1 } })
        const wrapped = new Error("wrapped", { cause: lost })

        await expect(effects.once(KEY, PERSON, plain(jest.fn().mockRejectedValue(wrapped)))).rejects.toBe(wrapped)

        expect(manager.update).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY }, { state: "unknown" })
    })

    it("releases the intent when the act throws a coded error whose outcomeUnknown is not 1", async () => {
        const { effects, manager } = await build()
        const refusal = new ProviderError({ code: "PROVIDER_REFUSED", params: { outcomeUnknown: 0 } })

        await expect(effects.once(KEY, PERSON, plain(jest.fn().mockRejectedValue(refusal)))).rejects.toBe(refusal)

        expect(manager.delete).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY })
    })

})

describe("EffectsService.once: failures of the ledger", () => {
    it("refuses a stored result of a shape no code writes", async () => {
        const row = ledgerRow("done")
        Reflect.set(row, "result", { other: 1 })
        const { effects } = await build(row)

        await expect(effects.once(KEY, PERSON, kept(() => Promise.resolve(1)))).rejects.toMatchObject({
            code: EffectsErrorCode.LedgerRowRejected,
        })
    })

    it("throws an OUTCOME_UNKNOWN that is class input for the job runner, so the job dead-letters instead of retrying", async () => {
        const { effects } = await build(ledgerRow("intent"))

        const failure: unknown = await effects.once(KEY, PERSON, plain(() => Promise.resolve(1))).catch((error: unknown) => error)

        expect(failure).toMatchObject({ code: EffectsErrorCode.OutcomeUnknown })
        expect(classifyFailure(failure)).toBe("input")
    })
})

describe("EffectsService.settleIn", () => {
    it("settles the key as done with the kept result on the transaction manager, not the injected one", async () => {
        const { effects, manager } = await build()
        const tx = mockEntityManager({ update: [EffectLedgerEntity, { affected: 1 }] })

        await effects.settleIn(tx, KEY, { stored: 3 })

        expect(tx.update).toHaveBeenCalledWith(EffectLedgerEntity, { key: KEY }, doneWith({ kept: { stored: 3 } }))
        expect(manager.update).not.toHaveBeenCalled()
    })

    it("refuses a key that has no intent row", async () => {
        const { effects } = await build()
        const tx = mockEntityManager({ update: [EffectLedgerEntity, { affected: 0 }] })

        await expect(effects.settleIn(tx, KEY, 1)).rejects.toMatchObject({ code: EffectsErrorCode.IntentMissing })
    })
})

describe("EffectLedgerRules on another ledger (QB-EFFECTS: one rule book, the ledger a port)", () => {
    const ledgerOf = (): jest.Mocked<EffectLedger> => ({
        find: jest.fn().mockResolvedValue(null),
        open: jest.fn().mockResolvedValue(true),
        reopen: jest.fn().mockResolvedValue(undefined),
        settle: jest.fn().mockResolvedValue(true),
        markUnknown: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isOutcomeUnknown: jest.fn().mockReturnValue(false),
        failureOf: jest.fn().mockReturnValue(new Error("family failure")),
    })

    it("releases the intent of an answer that says nothing was done and answers it, keeping nothing", async () => {
        const ledger = ledgerOf()
        const call = { ...kept(() => Promise.resolve(-1)), nothingDone: (answer: number) => answer < 0 }

        await expect(new EffectLedgerRules(ledger).once(KEY, PERSON, call)).resolves.toBe(-1)

        expect(ledger.release).toHaveBeenCalledWith(KEY)
        expect(ledger.settle).not.toHaveBeenCalled()
    })

    it("answers the row another try wrote first when the intent was lost to it, without acting", async () => {
        const ledger = ledgerOf()
        ledger.find.mockResolvedValueOnce(null).mockResolvedValueOnce({ name: "provider.send", state: "done", kept: { kept: { id: 4 } } })
        ledger.open.mockResolvedValue(false)
        const act = jest.fn(() => Promise.resolve(1))

        await expect(new EffectLedgerRules(ledger).once(KEY, PERSON, kept(act))).resolves.toBe(4)

        expect(act).not.toHaveBeenCalled()
    })

    it("throws the ledger's own failure for a lost act of a person effect, after marking it unknown", async () => {
        const ledger = ledgerOf()
        ledger.find.mockResolvedValue({ name: "provider.refund", state: "intent", kept: undefined })

        await expect(new EffectLedgerRules(ledger).once(KEY, PERSON, kept(() => Promise.resolve(1)))).rejects.toThrow("family failure")

        expect(ledger.markUnknown).toHaveBeenCalledWith(KEY, undefined)
    })
})

describe("EffectsService.once: a kept SECRET is sealed on the ledger", () => {
    const FAKE_SECRET = "fake-link-token-0001"
    const secretCall = (act: () => Promise<string>): EffectCallKept<string> => ({
        act,
        keep: (token) => ({ token }),
        from: (value: EffectResult) => (isRecord(value) ? String(value.token) : ""),
        secret: true,
    })
    const KEY_TEXT = randomBytes(32).toString("base64")
    const buildSealed = async (found: EffectLedgerEntity | null, withKey: boolean, keyText: string = KEY_TEXT) => {
        const manager = mockEntityManager({
            findOne: [EffectLedgerEntity, found],
            insert: [EffectLedgerEntity, {}],
            update: [EffectLedgerEntity, { affected: 1 }],
            delete: [EffectLedgerEntity, {}],
        })
        const options = withKey ? { connection: "x", sealingKey: new Secret(keyText) } : { connection: "x" }
        const moduleRef = await Test.createTestingModule({
            providers: [
                EffectsService,
                { provide: EFFECTS_MANAGERS, useValue: [manager] },
                { provide: EFFECTS_OPTIONS, useValue: options },
            ],
        }).compile()
        return { effects: moduleRef.get(EffectsService), manager }
    }
    /** The result column written by the settle of the one update the call made. */
    const writtenResult = (manager: { update: jest.Mock }): unknown => {
        const [, , columns] = manager.update.mock.calls.at(-1) as [unknown, unknown, { result: { kept: unknown } }]
        return columns.result.kept
    }

    it("writes the kept value sealed (never in plain text) and answers the opened value to the caller", async () => {
        const { effects, manager } = await buildSealed(null, true)

        await expect(effects.once(KEY, REPEATABLE, secretCall(() => Promise.resolve(FAKE_SECRET)))).resolves.toBe(FAKE_SECRET)

        const written = writtenResult(manager)
        expect(typeof written).toBe("string")
        expect(String(written)).not.toContain(FAKE_SECRET)
    })

    it("opens a sealed kept value of a settled row and answers it without acting", async () => {
        const first = await buildSealed(null, true)
        await first.effects.once(KEY, REPEATABLE, secretCall(() => Promise.resolve(FAKE_SECRET)))
        const sealed = writtenResult(first.manager) as string
        const act = jest.fn(() => Promise.resolve("another"))
        const { effects } = await buildSealed(ledgerRow("done", { kept: sealed }), true)

        await expect(effects.once(KEY, PERSON, secretCall(act))).resolves.toBe(FAKE_SECRET)

        expect(act).not.toHaveBeenCalled()
    })

    it("refuses a secret call when the capability has no sealing key, before any intent or act", async () => {
        const { effects, manager } = await buildSealed(null, false)
        const act = jest.fn(() => Promise.resolve(FAKE_SECRET))

        await expect(effects.once(KEY, REPEATABLE, secretCall(act))).rejects.toMatchObject({ code: EffectsErrorCode.SealingMissing })

        expect(act).not.toHaveBeenCalled()
        expect(manager.insert).not.toHaveBeenCalled()
    })

    it("cannot open a sealed value with another key: the row is unreadable, never answered", async () => {
        const first = await buildSealed(null, true)
        await first.effects.once(KEY, REPEATABLE, secretCall(() => Promise.resolve(FAKE_SECRET)))
        const sealed = writtenResult(first.manager) as string
        const other = await buildSealed(ledgerRow("done", { kept: sealed }), true, randomBytes(32).toString("base64"))

        await expect(other.effects.once(KEY, PERSON, secretCall(() => Promise.resolve("x")))).rejects.toMatchObject({
            code: "SEALING_UNREADABLE",
        })
    })

    it("refuses a settled secret row whose kept value is not a sealed text", async () => {
        const { effects } = await buildSealed(ledgerRow("done", { kept: { token: FAKE_SECRET } }), true)

        await expect(effects.once(KEY, PERSON, secretCall(() => Promise.resolve("x")))).rejects.toMatchObject({
            code: EffectsErrorCode.LedgerRowRejected,
        })
    })
})
