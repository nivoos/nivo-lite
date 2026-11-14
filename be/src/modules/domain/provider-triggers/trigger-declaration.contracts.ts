import type { TriggerCombine } from "@nivo-lite/agent-sdk/graph"
import type { TriggerVerb } from "@nivo-lite/agent-sdk/names"
import type { ZodType } from "zod"

/*
 * STAGE 1 OF THE ONE EVENT PIPELINE (lane concept triggers rule 13): the ADAPTER. Every source of an event (a provider's webhook or poll,
 * the clock, a timer, the website form, the team chat, a workflow call) declares each trigger it emits as DATA plus one PURE function:
 * `translate(raw)` turns what the source received (already verified by its entry) into the canonical event, or null to drop it. It reads
 * nothing, writes nothing and calls nothing: the same raw always gives the same event. Keeping the event once (stage 2, the inbox), meeting
 * the person of its `subject` (stage 3, enrich), matching the registered graphs (stage 4) and correlating into a run (stage 5) are the
 * engine's, driven by this declaration and never by the source's code.
 */

/** One way the source learns of the event: a delivery to its webhook, its own poll, the engine's clock, or an event inside NIVO. */
export type TriggerVia = "webhook" | "poll" | "clock" | "internal"

/** Every way one trigger is received: non-empty, no duplicates (the gate checks the duplicates). */
export type TriggerWays = readonly [TriggerVia, ...ReadonlyArray<TriggerVia>]

/** Why a trigger received by no poll loses no event: the reason as the owner reads it, and where the guarantee is stated. */
export interface TriggerWithoutPoll {
    /** The reason (vi / en): the provider's re-delivery guarantee, or the engine's sweep that brings a missed one back. */
    readonly reason: TriggerWords
    /** Where it is stated: the provider's document URL, or `nivo:<sweep>` (the existing job or tick of NIVO that brings it back). */
    readonly source: string
}

/**
 * The person an event is about, as the channel names them: the channel, the channel's own id of the person on the account the event came
 * through, and the name and picture when the source's payload gives them (absent: the payload does not say; never a guess). A channel that
 * reaches a person by a PERSON-LEVEL identity (a mail address: the same person on every account) declares its kind in `identity`: the id is
 * then that identity's value, and ENRICH meets the person by it (`ContactsService.meetAddress`), never as one account's own id.
 */
export interface EventSubject {
    /** The channel of the identity (`zalo`, `telegram`, `facebook`, `instagram`, `website`, `email`). */
    readonly channel: string
    /** The channel's own id of the person, or the value of the person-level identity `identity` names. */
    readonly id: string
    /** The kind of a person-level identity the id is (`email`); absent: the id is the channel's own id of the person on the account. */
    readonly identity?: "email" | undefined
    /** The name the payload gives, when it gives one. */
    readonly name?: string | undefined
    /** The address of the picture the payload gives, when it gives one. */
    readonly picture?: string | undefined
}

/** The canonical event a translate gives: the source's own id of the event, the person it is about when there is one, and its data. */
export interface CanonicalEvent<Data extends object = Readonly<Record<string, unknown>>> {
    /** The source's own id of the event: what keeps a repeat (a redelivery, the poll that reconciles a webhook) to one. */
    readonly id: string
    /** The person, for an event about one (a customer line); absent for any other event. */
    readonly subject?: EventSubject | undefined
    /** The event's data, in the shape the declaration's `data` schema types. */
    readonly data: Data
}

/**
 * What finds the run in flight an event joins, unless a registration declares its own key (concept triggers rule 13, stage 5): the
 * engine's route of the subject on the account (`subject`), the contact the event is about (`contact`: a workflow call's caller), one
 * member of the data (`data`), or nothing (`none`: every event its own run).
 */
export type CorrelationKey =
    | { readonly by: "subject" }
    | { readonly by: "contact" }
    | { readonly by: "data"; readonly member: string }
    | { readonly by: "none" }

/**
 * Where a raw was received: the account (connection) it came through, null for a source of the engine's own. A translate reads it as part
 * of its input (a Telegram message id is only unique inside its bot, so the line's key names the bot's account); it is never looked up.
 */
export interface TriggerOrigin {
    /** The account the raw came through, or null. */
    readonly connectionId: string | null
}

/**
 * How long a run of a key waits for the key to be quiet before it STARTS (the source's property, ROAD-HANDOVER final rule 2): each new
 * event of the key extends the window, `maxWaitMs` after the oldest pending event the run starts anyway (null: no cap). The same shape as
 * the wake's `settle` (agent-work `AgentWake.settle`). A chat message settles a few seconds, capped; every other source zero.
 */
export interface TriggerSettle {
    /** The quiet time, in milliseconds. */
    readonly windowMs: number
    /** The longest wait after the oldest pending event, in milliseconds, or null for no cap. */
    readonly maxWaitMs: number | null
}

/** A label in the owner's two languages. */
export interface TriggerWords {
    /** Vietnamese. */
    readonly vi: string
    /** English. */
    readonly en: string
}

/** What the owner's pages say of a trigger: its title (`<source> · <event>`), what it is, and what each member of its `data` means. */
export interface TriggerOwnerWords {
    /** The short title a drawer or a card names it by. */
    readonly title: TriggerWords
    /** What it is. */
    readonly summary: TriggerWords
    /** What a member of the declaration's `data` means, keyed by the member (every key must be a member of `data`: the gate checks it). */
    readonly members?: Readonly<Record<string, TriggerWords>> | undefined
}

/**
 * The account switch of a trigger that opens an inbound stream the owner approves (concept triggers rule 6): absent = the trigger is on
 * while its account is (a customer channel's messages, a source of NIVO's own).
 */
export interface TriggerSwitch {
    /** True when one agent decides on the event (money, an answer) and every other one is only told: the owner may bind the decider. */
    readonly decided: boolean
    /** True when the switch is ON for an account no person ever switched (a completion of work NIVO itself asked for, rule 6a). */
    readonly onByDefault: boolean
}

/** One trigger a source declares: who emits it, the verb it feeds, how it is received, its two schemas, its translate and its key. */
export interface TriggerDeclaration<Raw = unknown, Data extends object = Readonly<Record<string, unknown>>> {
    /** The provider key (`zalo_oa`, `sepay`), or `nivo` for a source of the engine's own (the clock, a timer, the website form). */
    readonly provider: string
    /** The trigger's name inside its source (`message.received`, `transaction.received`). */
    readonly name: string
    /** The verb a graph registers on (`TRIGGER.*`). */
    readonly verb: TriggerVerb
    /**
     * EVERY way the source receives this ONE event (owner R95, closed list, non-empty, no duplicates): its webhook door, its poll (the
     * provider's poll receiver of `dataType`), the engine's clock, or an event inside NIVO. A trigger received by `webhook` AND `poll` is
     * one trigger: whichever way brings an event first keeps the row, the other finds it kept (the provider's own key); the poll's cadence is
     * its receiver's, never a second trigger.
     */
    readonly via: TriggerWays
    /**
     * Why a missed event needs no poll: REQUIRED when `via` has no `poll` (a webhook-only trigger: e.g. the provider forbids polling while a
     * webhook is set and re-delivers itself, with its verified guarantee words; an engine source: the existing sweep that brings a missed
     * one back), absent when `via` has `poll` (its kept position is its recovery). The gate prints every webhook-only reason as its
     * allow-list: a visible decision.
     */
    readonly withoutPoll?: TriggerWithoutPoll | undefined
    /** What the owner's pages say of it. */
    readonly words: TriggerOwnerWords
    /** The account switch, when the trigger opens a stream the owner approves; absent = on while the account is. */
    readonly switch?: TriggerSwitch | undefined
    /**
     * The account_data type its raw rows are kept as (`zalo_oa.event`, `sepay.transaction`): what its webhook door and its poll receiver
     * write through the intake. Absent for a source of NIVO's own (no account row).
     */
    readonly dataType?: string | undefined
    /** The shape of what the entry hands `translate`, as the source received it. */
    readonly raw: ZodType<Raw>
    /** The shape of the canonical event's `data`. */
    readonly data: ZodType<Data>
    /**
     * The pure adapter: the canonical event of one raw (for an account event: the VALUE of the inbox row the entry kept, so the engine can
     * run it again on the stored row), or null when the source does not answer it (a seen receipt, a join). A function of its two
     * arguments only.
     */
    translate(raw: Raw, origin: TriggerOrigin): CanonicalEvent<Data> | null
    /** The default correlation key. */
    readonly key: CorrelationKey
    /** The settle time before a run of a key starts; null (or absent) = zero, the run starts at once. */
    readonly settle?: TriggerSettle | null | undefined
    /**
     * How the pending events of one subject combine (rule Q-4): `each` (absent: every event its own, in order), `latest` (only the newest;
     * typed, not built yet), `stream` (one marker, the oldest event, with `since` and `count`; the workflow reads the stream). `stream` is
     * allowed only on a declaration that feeds a stream of the engine: one that declares `line` (the registry refuses any other at boot).
     */
    readonly combine?: TriggerCombine | undefined
    /**
     * PURE, optional: this event is a person's message on its route (R26, MESSAGES-PLAN.md E3): the key the source gives the message (once
     * on the route), its words and the channel's time; null when this event is none (the release door's resume). Read on the PARSED data.
     */
    line?(data: Data): DeclaredLine | null
    /**
     * PURE, optional (owner R97): the identity the SOURCE gives the fact this event reports (a bank transfer's reference, a form submission's
     * id), read from declared members of the PARSED data only, never a hash or comparison of words; null when this event carries none. Two
     * events of one workspace and one VERB with the same fact key are ONE fact: the engine delivers the first and records every later one as
     * the same fact as it (counted, with the reason), for as long as the event's account_data type keeps its rows. Absent = every event is its
     * own fact. A declaration that declares `line` never declares it (two identical lines of a person are two lines: the gate refuses it).
     */
    factKey?(data: Data): string | null
}

/** A person's message as its source declares it: the source's key of the message, its words, the channel's time (ISO) or null. */
export interface DeclaredLine {
    readonly key: string
    readonly text: string
    readonly at: string | null
}

/** A canonical event, or null where the source drops the raw. */
export type OptionalCanonicalEvent<Data extends object = Readonly<Record<string, unknown>>> = CanonicalEvent<Data> | null
