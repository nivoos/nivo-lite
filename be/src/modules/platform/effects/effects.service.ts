import { Injectable, Optional } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity"
import type { JobEffectDeclaration } from "@modules/platform/jobs"
import { isRecord } from "@modules/platform/primitives"
import { isDomainError } from "@modules/platform/errors"
import { sealerOf, type SecretSealer } from "@modules/platform/sealing"
import { InjectEffectsManagers, InjectEffectsOptions } from "./effects.decorators"
import type { EffectsOptions } from "./effects.options"
import type {
    EffectCallKept,
    EffectCallPlain,
    EffectLedger,
    EffectLedgerKept,
    EffectLedgerRow,
    EffectResult,
    Effects,
} from "./effects.port"
import { EffectsError, EffectsErrorCode } from "./errors/effects.error"
import { EffectLedgerEntity, type EffectKept } from "./persistence/entities"

/** How many links of a cause chain are read for the typed `outcomeUnknown` param. */
const CAUSE_DEPTH = 5

/** A call of `once`: an act whose answer is not kept, or one whose answer is. */
type Call<T> = EffectCallPlain | EffectCallKept<T>

/** What the read that confirms a lost act found: the act did not happen, or it did (with its answer when the call keeps one). */
type Confirmed<T> = { readonly happened: false } | { readonly happened: true; readonly answer: T | undefined }

/** True for a call that keeps the act's answer. */
const isKept = <T>(call: Call<T>): call is EffectCallKept<T> => call.keep !== undefined

const isEffectResult = (value: unknown): value is EffectResult => {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true
    if (Array.isArray(value)) return value.every(isEffectResult)
    return isRecord(value) && Object.values(value).every(isEffectResult)
}

/** Parses the text a secret kept value was sealed from; a text no code wrote is refused. */
const parsedSecret = (text: string): EffectResult => {
    let value: unknown
    try {
        value = JSON.parse(text)
    } catch (cause) {
        throw new EffectsError({ code: EffectsErrorCode.LedgerRowRejected, cause })
    }
    if (!isEffectResult(value)) throw new EffectsError({ code: EffectsErrorCode.LedgerRowRejected })
    return value
}

/** The kept value of a settled row, if it kept one; a stored shape no code writes is refused. */
const keptOf = (row: EffectLedgerEntity): EffectKept | undefined => {
    const stored: unknown = row.result
    if (stored === null || stored === undefined) return undefined
    if (!isRecord(stored) || !isEffectResult(stored.kept)) throw new EffectsError({ code: EffectsErrorCode.LedgerRowRejected })
    return { kept: stored.kept }
}

/** True when the failure, or a cause in its chain, is a coded error carrying the typed param `outcomeUnknown: 1`. */
const isOutcomeUnknown = (failure: unknown): boolean => {
    let current = failure
    for (let depth = 0; depth < CAUSE_DEPTH && current instanceof Error; depth += 1) {
        if (isDomainError(current) && current.params.outcomeUnknown === 1) return true
        current = current.cause
    }
    return false
}

/**
 * THE rules of an act outside the database, over any ledger (J-5, concept saga-forward-only "Names": OUTBOX + JOB): the intent before
 * the act, the settle after it, and the settling of a lost act (repeatable / confirm / person). A ledger only reads and writes rows; no
 * other code decides what a found intent, a kept unknown or a refusal means. `EffectsService` runs them on `public.effect_ledger`; a
 * capability with its own table (the graph nodes' `agent_node_effects`) runs them on an adapter of that table.
 */
export class EffectLedgerRules {
    /** `sealer` seals the kept value of a call declared `secret`; a ledger run with none refuses such a call. */
    constructor(
        private readonly ledger: EffectLedger,
        private readonly sealer?: SecretSealer,
    ) {}

    /** Makes the act at most once per key (see `Effects.once`). */
    async once(key: string, effect: JobEffectDeclaration, call: EffectCallPlain): Promise<void>
    async once<T>(key: string, effect: JobEffectDeclaration, call: EffectCallKept<T>): Promise<T>
    async once<T>(key: string, effect: JobEffectDeclaration, call: Call<T>): Promise<T | undefined> {
        // A secret call with no sealer is refused BEFORE any intent or act: nothing happened that could not be kept.
        if (isKept(call) && call.secret === true) this.sealerFor(effect)
        const row = await this.ledger.find(key)
        if (row !== null) return this.found(key, effect, call, row)
        if (!(await this.ledger.open(key, effect.name))) return this.found(key, effect, call, await this.winner(key, effect))
        return this.act(key, effect, call)
    }

    /** Settles an OPEN row (an intent, a kept unknown) with the answer a confirmation read proved: true when a row was settled. */
    settleOpen(key: string, result: EffectResult): Promise<boolean> {
        return this.ledger.settle(key, { kept: result })
    }

    /** What a key the ledger already holds answers: a kept result, or a lost act settled as the effect declares. */
    private found<T>(key: string, effect: JobEffectDeclaration, call: Call<T>, row: EffectLedgerRow): Promise<T | undefined> {
        if (row.state === "done") {
            if (row.kept !== undefined && isKept(call)) return Promise.resolve(this.answerOf(effect, call, row.kept.kept))
            if (effect.settle === "repeatable") return this.again(key, effect, call)
            // Nothing was to be kept: the act happened and no later call needs its answer.
            if (!isKept(call)) return Promise.resolve(undefined)
        }
        return this.settleLost(key, effect, call, row)
    }

    /** The row another try wrote first under the key; a key lost to a try that then holds no row is the ledger's failure. */
    private async winner(key: string, effect: JobEffectDeclaration): Promise<EffectLedgerRow> {
        const row = await this.ledger.find(key)
        if (row === null) throw this.ledger.failureOf(key, effect, null)
        return row
    }

    /** An intent or an unknown row found before this call inserted: the act was lost; settle it as the effect declares. */
    private async settleLost<T>(
        key: string,
        effect: JobEffectDeclaration,
        call: Call<T>,
        row: EffectLedgerRow,
    ): Promise<T | undefined> {
        if (effect.settle === "repeatable") return this.again(key, effect, call)
        if (effect.settle === "confirm") {
            const found = await this.confirmed(effect, call)
            if (found.happened) {
                await this.ledger.settle(key, isKept(call) && found.answer !== undefined ? this.keptOf(effect, call, found.answer) : undefined)
                return found.answer
            }
        }
        await this.ledger.markUnknown(key, undefined)
        throw this.ledger.failureOf(key, effect, row)
    }

    /** The read that tells whether a lost act happened; a call with none cannot be settled. */
    private async confirmed<T>(effect: JobEffectDeclaration, call: Call<T>): Promise<Confirmed<T>> {
        if (call.confirm === undefined)
            throw new EffectsError({ code: EffectsErrorCode.ConfirmMissing, params: { effect: effect.name } })
        if (!isKept(call)) return (await call.confirm()) ? { happened: true, answer: undefined } : { happened: false }
        const answer = await call.confirm()
        return answer === null ? { happened: false } : { happened: true, answer }
    }

    /** Acts again under the same key: the row is an intent again first. */
    private async again<T>(key: string, effect: JobEffectDeclaration, call: Call<T>): Promise<T | undefined> {
        await this.ledger.reopen(key)
        return this.act(key, effect, call)
    }

    /**
     * The act after its intent: an answer that says nothing was done releases the intent and is answered, never kept; any other answer
     * settles the row with what the call keeps of it. A settle that moved nothing (another try holds the key) answers what that try
     * kept, and never acts again: an open row then is an outcome unknown.
     */
    private async act<T>(key: string, effect: JobEffectDeclaration, call: Call<T>): Promise<T | undefined> {
        if (!isKept(call)) {
            await this.guarded(key, call.act)
            return (await this.ledger.settle(key, undefined)) ? undefined : this.afterLost<T>(key, effect, call)
        }
        const answer = await this.guarded(key, call.act)
        if (call.nothingDone?.(answer) === true) {
            await this.ledger.release(key)
            return answer
        }
        return (await this.ledger.settle(key, this.keptOf(effect, call, answer))) ? answer : this.afterLost(key, effect, call)
    }

    /** What a key answers after this call's act lost the settle to another try: its kept result, else an outcome unknown. */
    private async afterLost<T>(key: string, effect: JobEffectDeclaration, call: Call<T>): Promise<T | undefined> {
        const row = await this.winner(key, effect)
        if (row.state !== "done") throw this.ledger.failureOf(key, effect, row)
        if (!isKept(call)) return undefined
        if (row.kept === undefined) throw this.ledger.failureOf(key, effect, row)
        return this.answerOf(effect, call, row.kept.kept)
    }

    /** What the ledger keeps of an answer: `keep`'s value, sealed when the call declares it a secret. */
    private keptOf<T>(effect: JobEffectDeclaration, call: EffectCallKept<T>, answer: T): EffectLedgerKept {
        const value = call.keep(answer)
        return { kept: call.secret === true ? this.sealerFor(effect).seal(JSON.stringify(value)) : value }
    }

    /** The answer a kept value rebuilds: a secret one is opened first. */
    private answerOf<T>(effect: JobEffectDeclaration, call: EffectCallKept<T>, kept: EffectResult): T {
        if (call.secret !== true) return call.from(kept)
        if (typeof kept !== "string") throw new EffectsError({ code: EffectsErrorCode.LedgerRowRejected })
        return call.from(parsedSecret(this.sealerFor(effect).open(kept)))
    }

    /** The sealer of a call that keeps a secret; none registered is a wiring bug. */
    private sealerFor(effect: JobEffectDeclaration): SecretSealer {
        if (this.sealer === undefined) throw new EffectsError({ code: EffectsErrorCode.SealingMissing, params: { effect: effect.name } })
        return this.sealer
    }

    /** Runs the act: a throw releases the intent unless the ledger reads it as an unknown outcome, which keeps the row as unknown. */
    private async guarded<A>(key: string, act: () => Promise<A>): Promise<A> {
        try {
            return await act()
        } catch (error) {
            if (this.ledger.isOutcomeUnknown(error)) await this.ledger.markUnknown(key, error)
            else await this.ledger.release(key)
            throw error
        }
    }
}

/** The jobs' ledger: the rows of `public.effect_ledger` on one entity manager, each write its own statement. */
class EffectLedgerTable implements EffectLedger {
    constructor(private readonly writer: () => EntityManager) {}

    async find(key: string): Promise<EffectLedgerRow | null> {
        const row = await this.writer().findOne(EffectLedgerEntity, { where: { key } })
        if (row === null) return null
        return { name: row.name, state: row.state, kept: row.state === "done" ? keptOf(row) : undefined }
    }

    async open(key: string, name: string): Promise<boolean> {
        await this.writer().insert(EffectLedgerEntity, { key, name, state: "intent" })
        return true
    }

    async reopen(key: string): Promise<void> {
        await this.writer().update(EffectLedgerEntity, { key }, { state: "intent", result: null, settledAt: null })
    }

    async settle(key: string, kept: EffectLedgerKept | undefined): Promise<boolean> {
        await this.writer().update(EffectLedgerEntity, { key }, doneWith(kept))
        return true
    }

    async markUnknown(key: string): Promise<void> {
        await this.writer().update(EffectLedgerEntity, { key }, { state: "unknown" })
    }

    async release(key: string): Promise<void> {
        await this.writer().delete(EffectLedgerEntity, { key })
    }

    isOutcomeUnknown(failure: unknown): boolean {
        return isOutcomeUnknown(failure)
    }

    failureOf(key: string, effect: JobEffectDeclaration, found: EffectLedgerRow | null): Error {
        if (found === null) return new EffectsError({ code: EffectsErrorCode.IntentMissing, params: { effect: key } })
        return new EffectsError({ code: EffectsErrorCode.OutcomeUnknown, params: { effect: effect.name, key } })
    }
}

/** The columns of a row settled as done. */
const doneWith = (kept: EffectKept | undefined): QueryDeepPartialEntity<EffectLedgerEntity> => ({
    state: "done",
    result: kept ?? null,
    settledAt: () => "now()",
})

@Injectable()
/**
 * The intent-before-act ledger of the acts outside the database: `EffectLedgerRules` on `public.effect_ledger`. The intent is committed
 * on its own statement (autocommit on the injected manager) before the act; the caller is a fenced job (one live worker per key), so an
 * intent found before this call inserts is a lost act whose outcome is unknown.
 */
export class EffectsService implements Effects {
    private readonly rules: EffectLedgerRules

    constructor(
        @InjectEffectsManagers() private readonly managers: ReadonlyArray<EntityManager>,
        @Optional() @InjectEffectsOptions() options: EffectsOptions | null = null,
    ) {
        const key = options?.sealingKey?.reveal()
        this.rules = new EffectLedgerRules(new EffectLedgerTable(() => this.writer()), key === undefined ? undefined : sealerOf(key))
    }

    /** Makes the act at most once per key. */
    async once(key: string, effect: JobEffectDeclaration, call: EffectCallPlain): Promise<void>
    async once<T>(key: string, effect: JobEffectDeclaration, call: EffectCallKept<T>): Promise<T>
    async once<T>(key: string, effect: JobEffectDeclaration, call: Call<T>): Promise<T | undefined> {
        if (isKept(call)) return this.rules.once(key, effect, call)
        await this.rules.once(key, effect, call)
        return undefined
    }

    /** Settles a key inside the caller transaction, so the domain write that keeps the answer and the settle commit together. */
    async settleIn(tx: EntityManager, key: string, result: EffectResult): Promise<void> {
        const settled = await tx.update(EffectLedgerEntity, { key }, doneWith({ kept: result }))
        if (!settled.affected) throw new EffectsError({ code: EffectsErrorCode.IntentMissing, params: { effect: key } })
    }

    /** The entity manager of the connection that holds the effect ledger. */
    private writer(): EntityManager {
        const [manager] = this.managers
        if (manager === undefined) throw new EffectsError({ code: EffectsErrorCode.ConnectionMissing })
        return manager
    }
}
