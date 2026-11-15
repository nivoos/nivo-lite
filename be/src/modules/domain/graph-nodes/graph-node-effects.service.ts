import { createHash } from "node:crypto"
import { Injectable } from "@nestjs/common"
import { isRefused, type EffectCall, type SubjectRef } from "@nivo-lite/agent-sdk/node"
import type { JsonValue } from "@nivo-lite/agent-sdk/schema"
import { isDomainError } from "@modules/platform/errors"
import {
    EffectLedgerRules,
    type EffectLedger,
    type EffectLedgerKept,
    type EffectLedgerRow,
    type EffectResult,
} from "@modules/platform/effects"
import type { JobEffectDeclaration } from "@modules/platform/jobs"
import { repeatableBySpec, staysInsideBySpec } from "@modules/domain/tool-specs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import {
    EffectOutcomeUnknownCode,
    EffectOutcomeUnknownError,
    GraphNodesError,
    GraphNodesErrorCode,
    isOutcomeUnknownCode,
} from "./errors/graph-nodes.error"
import type { EffectAct } from "./graph-nodes.contracts"
import { GraphNodesLogEvent } from "./graph-nodes.log-events"
import { InjectNodeEffectStore } from "./graph-nodes.decorators"
import type { EffectInsert, EffectResettle, NodeEffectStore, StoredEffect } from "./node-effect-store.port"

/** The longest key the ledger keeps (`agent_node_effects.effect_key`). */
const KEY_MAX = 200

/**
 * The ledger key of a call: its business key when the node named one, else the run step's own (the step, then a digest of the effect
 * and its arguments, which the runner makes). A key too long for the ledger is kept as its digest: the same call gives the same digest.
 */
export const ledgerKeyOf = (call: EffectCall): string => {
    const key = call.dedupeKey === null ? `call:${call.key}` : `dedupe:${call.dedupeKey}`
    return key.length <= KEY_MAX ? key : `digest:${createHash("sha256").update(key).digest("hex")}`
}

/** The prefix of a ledger key made from a run step's own call key (`ledgerKeyOf`). */
const CALL_KEY_PREFIX = "call:"

/**
 * The call a ledger key was made from, when it can be read back: a run step's own call key (`call:<key>`) is that call with no business
 * key. A business key (`dedupe:`) or a digest of a key too long names no call key: null.
 */
export const callOfLedgerKey = (ledgerKey: string): EffectCall | null =>
    ledgerKey.startsWith(CALL_KEY_PREFIX) ? { key: ledgerKey.slice(CALL_KEY_PREFIX.length), dedupeKey: null } : null

/** The kind a ledger record names as its subject when its act ended with an outcome nobody knows (see `OUTCOME_UNKNOWN_CODES`). */
export const OUTCOME_UNKNOWN_KIND = "outcome-unknown"

/**
 * The kind a ledger record names as its subject while the act it stands for is under way: the INTENT written and committed BEFORE an act
 * outside NIVO's database (QB-P3 rule I-1); the act's answer fills it. An intent a later call finds with no result is an outcome nobody
 * knows (the process died between the act and its result).
 */
export const INTENT_KIND = "intent"

/** The ledger namespace of the engine's own facts (the step's instant and day): values the engine computes, never an act outside. */
const ENGINE_OWN_PREFIX = "engine."

/**
 * Whether an act may change something OUTSIDE NIVO's database, from declared data only (QB-P3 rule I-2): every id except the engine's own
 * facts and a core tool whose spec declares it stays inside (a read, or NIVO's own records). A plugin's effect, an ability's write and a
 * provider's tool are outside: the engine cannot prove an undeclared executor stays inside, and the safe side of not knowing is outside.
 */
export const actsOutside = (effect: string): boolean => !effect.startsWith(ENGINE_OWN_PREFIX) && !staysInsideBySpec(effect)

/** The open kind of a kept subject (an intent with no result, or an act whose outcome is unknown), or null for a settled one. */
const openKindOf = (subject: SubjectRef): string | null => {
    if (subject.kind === INTENT_KIND) return INTENT_KIND
    return subject.kind === OUTCOME_UNKNOWN_KIND && isOutcomeUnknownCode(subject.id) ? OUTCOME_UNKNOWN_KIND : null
}

/** The codes an act ends with when its effect may or may not have happened (`EffectOutcomeUnknownCode`). */
export const OUTCOME_UNKNOWN_CODES: ReadonlySet<string> = new Set(Object.values(EffectOutcomeUnknownCode))

/** The run and the step a call was made for. */
export interface CallPlace {
    /** The run. */
    readonly runId: string
    /** The step of the run (its key in the graph). */
    readonly stepKey: string
}

/** A step's call key: `<run id>:<step key>:<digest>` (the runner's), or `<run id>:<step key>:undo:<n>` (an undo of the old kernel). */
const STEP_CALL_KEY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.+?)(?::undo:\d+|:[^:]+)$/i

/** The run and the step of a call, read from its key; null for a key of another shape (a gateway operation key). */
export const placeOf = (callKey: string): CallPlace | null => {
    const [, runId, stepKey] = STEP_CALL_KEY.exec(callKey) ?? []
    return runId === undefined || stepKey === undefined || stepKey.length > KEY_MAX ? null : { runId, stepKey }
}

/** The bounds the ledger's JSON columns hold (`agent_node_effects.args` / `facts`). */
const JSON_TEXT_MAX = 20_000
const JSON_ENTRIES_MAX = 1_000
const JSON_DEPTH_MAX = 24

/** A JSON record as the ledger's `args` and `facts` fields hold it. */
export type LedgerJson = { readonly [key: string]: JsonValue }

/** True when a plain JSON value fits the ledger's bounds. */
const fits = (value: unknown, depth: number): value is JsonValue => {
    if (depth > JSON_DEPTH_MAX) return false
    if (value === null || typeof value === "boolean") return true
    if (typeof value === "number") return Number.isFinite(value)
    if (typeof value === "string") return value.length <= JSON_TEXT_MAX
    if (Array.isArray(value)) return value.length <= JSON_ENTRIES_MAX && value.every((item) => fits(item, depth + 1))
    if (typeof value !== "object") return false
    const entries = Object.entries(value)
    return (
        entries.length <= JSON_ENTRIES_MAX &&
        entries.every(([name, item]) => name.length <= KEY_MAX && fits(item, depth + 1))
    )
}

/** The plain record of a value, or null. */
const recordOf = (value: unknown): Readonly<Record<string, unknown>> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : null

/** A value that cannot be kept as JSON (a function, a symbol, a big integer, a cycle too deep). */
const NOT_JSON: unique symbol = Symbol("not-json")

/** The JSON a value stands for, as `JSON.stringify` would write it (a time as ISO text; an absent member left out), or `NOT_JSON`. */
const jsonOf = (value: unknown, depth: number): JsonValue | undefined | typeof NOT_JSON => {
    if (depth > JSON_DEPTH_MAX) return NOT_JSON
    if (value === undefined) return undefined
    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
    if (Array.isArray(value)) {
        const items = value.map((item) => jsonOf(item, depth + 1))
        return items.includes(NOT_JSON)
            ? NOT_JSON
            : items.map((item) => (item === undefined || item === NOT_JSON ? null : item))
    }
    const record = recordOf(value)
    if (record === null) return NOT_JSON
    const entries = Object.entries(record).map(([name, item]): [string, JsonValue | undefined | typeof NOT_JSON] => [
        name,
        jsonOf(item, depth + 1),
    ])
    if (entries.some(([, item]) => item === NOT_JSON)) return NOT_JSON
    return Object.fromEntries(
        entries.flatMap(([name, item]): Array<[string, JsonValue]> =>
            item === undefined || item === NOT_JSON ? [] : [[name, item]],
        ),
    )
}

/** True for a JSON record within the ledger's bounds. */
const isLedgerJson = (value: unknown): value is LedgerJson =>
    typeof value === "object" && value !== null && !Array.isArray(value) && fits(value, 0)

/**
 * A record as the ledger keeps it: plain JSON within the field's bounds, or null when it is none or does not fit. An argument or a
 * fact the ledger cannot hold is left out; it is never a reason to fail the write of an effect that already acted.
 */
export const ledgerJsonOf = (value: unknown): LedgerJson | null => {
    if (recordOf(value) === null) return null
    const plain = jsonOf(value, 0)
    return isLedgerJson(plain) ? plain : null
}

/** What the ledger kept under a key: the effect that ran and the subject it touched, with the facts it answered when kept. */
interface Kept {
    /** The effect the key was written by. */
    readonly effect: string
    /** The data kind and the id of the record the first run touched, with its facts. */
    readonly subject: SubjectRef
}

/** What a ledger row kept. */
const keptOf = (row: StoredEffect): Kept => {
    const subject: SubjectRef = { kind: row.subjectEntity, id: row.subjectId }
    return { effect: row.effectId, subject: row.facts === null ? subject : { ...subject, facts: row.facts } }
}

/** The most records of one run step the ledger reads back (a step makes a handful of calls). */
export const STEP_RECORDS_READ = 100

/** One effect a run step made, as the ledger kept it: what ran, with what, what it touched and answered, and when. */
export interface LedgerRecord {
    /** The effect. */
    readonly effect: string
    /** The arguments the call ran with; null when they were not kept (a record from before they were, or too large to keep). */
    readonly args: Readonly<Record<string, unknown>> | null
    /**
     * The subject it touched, with the facts it answered when kept; of kind `outcome-unknown` when nobody knows whether it acted, of kind
     * `intent` when it was written before its act and no result was kept.
     */
    readonly subject: SubjectRef
    /** When it was kept (ISO text): just after the act. */
    readonly at: string
    /** The ledger key it is kept under (`call:<run>:<step>:<digest>`, `dedupe:<key>`). */
    readonly key: string
}

/**
 * An act of a run step still OPEN in the ledger (an intent with no result, or an outcome kept unknown) of a tool that declares itself
 * `repeatable`, with what makes it again exactly: its call key and the arguments it was made with (E-FIX12 rule A-2).
 */
export interface OpenAct {
    /** The effect. */
    readonly effect: string
    /** The call it was made under (the same ledger key, the same send key). */
    readonly call: EffectCall
    /** The arguments it was made with. */
    readonly args: Readonly<Record<string, unknown>>
}

/** The member of an open row's facts that counts how many times its act was made under its key (E-FIX12 rule A-3). */
export const ACTS_MADE = "made"

/** How many times the act of an open row was made under its key, as the row counts it (1 when it does not count). */
const madeOf = (row: StoredEffect | null): number => {
    const made: unknown = row?.facts?.[ACTS_MADE]
    return typeof made === "number" && Number.isInteger(made) && made > 0 ? made : 1
}

/** Where a call is made and with what, as its caller knows it. */
export interface CallRecord {
    /** The arguments (the checked payload) the call runs with; absent, none are kept. */
    readonly args?: Readonly<Record<string, unknown>> | undefined
    /** The run and the step; absent, read from the call key (`placeOf`). */
    readonly place?: CallPlace | undefined
    /** True when a PERSON's Retry decided a lost act of this key (outcome unknown, declared `person`) is made again under the same key. */
    readonly decided?: true | undefined
}

/** The code a throw carries: a domain error's, or the `code` member of another object; null when it carries none. */
const thrownCodeOf = (cause: unknown): unknown => {
    if (isDomainError(cause)) return cause.code
    return typeof cause === "object" && cause !== null ? Reflect.get(cause, "code") : null
}

/** The outcome-unknown code an act threw, or null for any other throw. */
const unknownCodeOf = (cause: unknown): string | null => {
    const code = thrownCodeOf(cause)
    return isOutcomeUnknownCode(code) ? code : null
}

/** The row of a call whose act ended with an outcome nobody knows: its code as the subject. */
const unknownSubjectOf = (code: string, made: number): EffectResettle => ({
    subjectEntity: OUTCOME_UNKNOWN_KIND,
    subjectId: code,
    facts: { code, [ACTS_MADE]: made },
})

/** The state the shared effect rules read of a ledger row: an intent, an outcome kept unknown, or a settled act. */
const stateOf = (row: StoredEffect): EffectLedgerRow["state"] => {
    const open = openKindOf(keptOf(row).subject)
    if (open === INTENT_KIND) return "intent"
    return open === null ? "done" : "unknown"
}

/** What a settled row keeps for the shared rules: the subject and the facts the act answered. */
const keptSubjectOf = (subject: SubjectRef): EffectResult => ({
    kind: subject.kind,
    id: subject.id,
    facts: ledgerJsonOf(subject.facts),
})

/** The subject a kept result stands for (the inverse of `keptSubjectOf`); a result of another shape is no subject. */
const subjectOfKept = (kept: EffectResult): SubjectRef => {
    const record = recordOf(kept)
    const kind = record?.kind
    const id = record?.id
    if (typeof kind !== "string" || typeof id !== "string") {
        throw new GraphNodesError({ code: GraphNodesErrorCode.EffectNotRecorded, params: { effect: typeof kind === "string" ? kind : "" } })
    }
    const facts = recordOf(record?.facts)
    return facts === null ? { kind, id } : { kind, id, facts }
}

/** The columns an open row is settled to from what the rules keep. */
const resettleOf = (kept: EffectResult): EffectResettle => {
    const subject = subjectOfKept(kept)
    return { subjectEntity: subject.kind, subjectId: subject.id, facts: ledgerJsonOf(subject.facts) }
}

/** The columns of one call, as the row of its key keeps them beside the subject. */
type CallValues = Omit<EffectInsert, "subjectEntity" | "subjectId" | "facts">

/** What one call of the node ledger reads and writes through the shared effect rules. */
interface NodeLedgerCall {
    readonly store: NodeEffectStore
    readonly logger: Logger
    readonly workspaceId: string
    /** The effect of the call. */
    readonly effect: string
    /** The columns of the call's row. */
    readonly values: CallValues
    /** True for an act outside NIVO's database (QB-P3 rule I-2): its intent is written before it. */
    readonly outside: boolean
    /** True for a tool that declares itself `repeatable`. */
    readonly repeatable: boolean
    /** True when the key is known to hold a row before anything is read (a confirmation settling an open row). */
    readonly held?: boolean
}

/**
 * `agent_node_effects` as an `EffectLedger` of one call (its workspace, effect and columns): the rows only, keys and table unchanged.
 * The shared rules decide; this adapter maps their states onto the subject columns (`intent`, `outcome-unknown` + its code, else a
 * settled subject), types the failures as the engine reads them (`EffectOutcomeUnknownError` with the code, `GraphNodesError`), and
 * keeps the node ledger's own forms: an act INSIDE the database writes no intent (its row is written once after the act, insert or
 * nothing), a lost act found later stays the intent it was (its readers read an open intent as unknown), and a key another effect holds
 * is refused before anything acts. Releases and unknown keeps are best effort: the act's own answer or error is what the caller gets.
 */
class NodeEffectLedger implements EffectLedger {
    /** The row this call found or wrote under the key, or null while the key holds none of this call's. */
    private found: StoredEffect | null = null
    /** True while the key holds a row (found, or the intent this call wrote). */
    private written: boolean
    /** How many times this key's act was made, this call's act included (E-FIX12 rule A-3): 1 for a first act, one more per act again. */
    made = 1

    constructor(private readonly call: NodeLedgerCall) {
        this.written = call.held === true
    }

    async find(key: string): Promise<EffectLedgerRow | null> {
        const { store, workspaceId, effect, repeatable, logger } = this.call
        const row = await store.byKey(workspaceId, key)
        this.found = row
        this.written = row !== null
        if (row === null) return null
        if (row.effectId !== effect) {
            throw new GraphNodesError({ code: GraphNodesErrorCode.EffectKeyTaken, params: { effect, heldBy: row.effectId } })
        }
        const state = stateOf(row)
        if (state === "done" || !repeatable) logger.info(GraphNodesLogEvent.EffectReplayed, { workspaceId, effect })
        return { name: row.effectId, state, kept: state === "done" ? { kept: keptSubjectOf(keptOf(row).subject) } : undefined }
    }

    async open(): Promise<boolean> {
        if (!this.call.outside) return true
        const intended = await this.call.store.insert(this.call.workspaceId, {
            ...this.call.values,
            subjectEntity: INTENT_KIND,
            subjectId: INTENT_KIND,
            facts: null,
        })
        this.written = intended
        return intended
    }

    async reopen(key: string): Promise<void> {
        const { store, workspaceId, effect, logger } = this.call
        logger.info(GraphNodesLogEvent.EffectReplayed, { workspaceId, effect, again: true })
        // The act is made once more under the same key: the row's count of acts goes on from what it kept (a lost intent counts as one).
        this.made = madeOf(this.found) + 1
        if (this.found === null || stateOf(this.found) !== "unknown") return
        await store.resettle(workspaceId, key, OUTCOME_UNKNOWN_KIND, {
            subjectEntity: INTENT_KIND,
            subjectId: INTENT_KIND,
            facts: null,
        })
    }

    async settle(key: string, kept: EffectLedgerKept | undefined): Promise<boolean> {
        const { store, workspaceId, values } = this.call
        if (kept === undefined) return false
        const settled = resettleOf(kept.kept)
        if (!this.written) return store.insert(workspaceId, { ...values, ...settled })
        if (await store.resettle(workspaceId, key, INTENT_KIND, settled)) return true
        return store.resettle(workspaceId, key, OUTCOME_UNKNOWN_KIND, settled)
    }

    async markUnknown(key: string, failure: unknown): Promise<void> {
        const code = unknownCodeOf(failure)
        // A lost act found later stays the intent it was: its readers read an open intent as an outcome nobody knows.
        if (code === null) return
        const { store, workspaceId, values } = this.call
        const kept = this.written
            ? store.resettle(workspaceId, key, INTENT_KIND, unknownSubjectOf(code, this.made))
            : store.insert(workspaceId, { ...values, ...unknownSubjectOf(code, this.made) })
        await kept.catch(() => false)
    }

    async release(key: string): Promise<void> {
        if (!this.written) return
        await this.call.store.release(this.call.workspaceId, key, INTENT_KIND).catch(() => false)
        this.written = false
    }

    isOutcomeUnknown(failure: unknown): boolean {
        return unknownCodeOf(failure) !== null
    }

    failureOf(_key: string, effect: JobEffectDeclaration, found: EffectLedgerRow | null): Error {
        if (found === null || found.state === "done") {
            return new GraphNodesError({ code: GraphNodesErrorCode.EffectNotRecorded, params: { effect: effect.name } })
        }
        if (found.state === "intent") {
            return new EffectOutcomeUnknownError({
                code: EffectOutcomeUnknownCode.Tool,
                params: { effect: effect.name, open: INTENT_KIND },
            })
        }
        const stored = this.found?.subjectId
        const code = isOutcomeUnknownCode(stored) ? stored : EffectOutcomeUnknownCode.Tool
        return new EffectOutcomeUnknownError({ code, params: { effect: effect.name, [ACTS_MADE]: madeOf(this.found) } })
    }
}

/**
 * An outcome-unknown failure of an act with the count of acts its ledger row kept (E-FIX12 rule A-3: the facts a stop is written from
 * say how many times the act left, never a guess); any other failure, or one that already counts, as it was.
 */
const withActsMade = (cause: unknown, made: number): unknown => {
    const code = thrownCodeOf(cause)
    if (!isOutcomeUnknownCode(code)) return cause
    const params = isDomainError(cause) ? cause.params : {}
    if (ACTS_MADE in params) return cause
    return new EffectOutcomeUnknownError({ code, params: { ...params, [ACTS_MADE]: made }, cause })
}

@Injectable()
/**
 * The ledger that makes a node's effect act once, kept as rows of the core table `agent_node_effects` (`NODE_EFFECT_STORE`), keyed
 * `<run>:<step>:<digest>` (or the node's business key). It owns the KEYS, the columns of a call (run, step, arguments: D.1, what a step
 * already did is read back from here) and the node's declarations (`repeatable`, inside or outside, from tool-specs); the RULES (intent
 * before an act outside, fill, release on a refusal or a failure that says nothing happened, an unknown outcome kept, a lost act settled
 * by its declaration, never a blind second act) are the platform's ONE piece, `EffectLedgerRules`, run on this table (QB-EFFECTS). The
 * act itself runs outside any transaction (an effect may call a door, BE-PERSISTENCE-6). A refusal (`{ kind: "refused" }`) is never kept.
 * A `confirmBy` read is the runner's (it needs the step's door); its proof settles the open row through `settleOpen`.
 */
export class GraphNodeEffectsService {
    constructor(
        @InjectNodeEffectStore() private readonly store: NodeEffectStore,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** Runs the act once per key in the workspace and answers the subject the first run touched. */
    async once(
        workspaceId: string,
        effect: string,
        call: EffectCall,
        act: EffectAct,
        record: CallRecord = {},
    ): Promise<SubjectRef> {
        const ledgerKey = ledgerKeyOf(call)
        const place = record.place ?? placeOf(call.key)
        const repeatable = repeatableBySpec(effect) === true
        const values: CallValues = {
            effectKey: ledgerKey,
            effectId: effect,
            runId: place?.runId ?? null,
            stepKey: place?.stepKey ?? null,
            args: ledgerJsonOf(record.args),
        }
        const ledger = this.ledgerOf(workspaceId, effect, values, { outside: actsOutside(effect), repeatable })
        try {
            return await new EffectLedgerRules(ledger).once(ledgerKey, declarationOf(effect, repeatable), {
                act,
                keep: keptSubjectOf,
                from: subjectOfKept,
                // A refusal is an answer, not an act: nothing is kept under the key, so the call asked again later is really made again.
                nothingDone: isRefused,
                ...(record.decided === true ? { decided: true as const } : {}),
            })
        } catch (cause) {
            throw withActsMade(cause, ledger.made)
        }
    }

    /**
     * The acts of a run step still OPEN in the ledger (an intent with no result, or an outcome kept unknown) whose tool declares itself
     * `repeatable` and whose call and arguments the ledger kept (E-FIX12 rule A-2), oldest first: what an automatic retry of the step
     * makes again, exactly, before anything else. Settled acts, acts of other tools and acts kept under a business key are not listed.
     */
    async openActsOf(workspaceId: string, place: CallPlace): Promise<ReadonlyArray<OpenAct>> {
        const rows = await this.store.ofStep(workspaceId, place.runId, place.stepKey, STEP_RECORDS_READ)
        return rows.flatMap((row) => {
            const call = callOfLedgerKey(row.effectKey)
            if (stateOf(row) === "done" || repeatableBySpec(row.effectId) !== true || call === null || row.args === null) return []
            return [{ effect: row.effectId, call, args: row.args }]
        })
    }

    /**
     * Settles an OPEN row of a call (an intent with no result, or an outcome kept unknown) to the subject a confirmation read proved
     * (QB-P3 rule I-3: the tool's `confirmBy`, read by the runner): a later call of the key answers it. True when a row was settled; false
     * when the key holds no open row (nothing kept, or already settled).
     */
    async settleOpen(workspaceId: string, call: EffectCall, subject: SubjectRef): Promise<boolean> {
        const ledgerKey = ledgerKeyOf(call)
        const values: CallValues = { effectKey: ledgerKey, effectId: subject.kind, runId: null, stepKey: null, args: null }
        const ledger = this.ledgerOf(workspaceId, subject.kind, values, { outside: true, repeatable: false, held: true })
        return new EffectLedgerRules(ledger).settleOpen(ledgerKey, keptSubjectOf(subject))
    }

    /**
     * The effects a run step made, oldest first, as the ledger kept them (every attempt of the step, whatever conversation each call
     * addressed), cut to the effects named; empty when the step made none. Records written before the run and the step were kept are
     * not found here.
     */
    async recordsOf(
        workspaceId: string,
        place: CallPlace,
        effects: ReadonlyArray<string>,
    ): Promise<ReadonlyArray<LedgerRecord>> {
        const rows = await this.store.ofStep(workspaceId, place.runId, place.stepKey, STEP_RECORDS_READ)
        return rows.flatMap((row) => {
            const kept = keptOf(row)
            return !effects.includes(kept.effect)
                ? []
                : [{ effect: kept.effect, args: row.args, subject: kept.subject, at: row.createdAt, key: row.effectKey }]
        })
    }

    /** The node ledger of one call. */
    private ledgerOf(
        workspaceId: string,
        effect: string,
        values: CallValues,
        kind: Pick<NodeLedgerCall, "outside" | "repeatable" | "held">,
    ): NodeEffectLedger {
        return new NodeEffectLedger({ store: this.store, logger: this.logger, workspaceId, effect, values, ...kind })
    }
}

/** How the shared rules settle a lost act of a node's effect: a `repeatable` tool is made again; any other waits for a person. */
const declarationOf = (effect: string, repeatable: boolean): JobEffectDeclaration => ({
    name: effect,
    settle: repeatable ? "repeatable" : "person",
})
