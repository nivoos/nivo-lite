import type { DeclaredLine } from "./trigger-declaration.contracts"
import type { DeliverInput, DeliveredEvent, DeliveredRaw, TriggerTaker } from "./provider-triggers.contracts"
import type { EventScope } from "./trigger-delivery.policy"

/*
 * THE TWO PHASES OF ONE DELIVERY (concept outbox-job rule 12; DELIVER-TX). PREPARE (`ProviderTriggersService.prepare`) does every read
 * through the pool and every outside act, with NO transaction open: the account and its switch, the files of the event kept in the shop's
 * store, the person met and their route ensured (ENRICH), the agents attached to the account and, for each, the registration that takes
 * the event or the wait that lists its verb (MATCH). COMMIT (`ProviderTriggersService.deliver`) is one short transaction on the caller's
 * one connection: the switch read again, the same-fact claim, the person's line on its route stream, the hold, the wakes and their combine.
 * The brand below is not exported from the barrel: a `PreparedDelivery` exists only because `prepare` made it, so no caller can commit an
 * event it did not prepare outside its transaction.
 */

/** The brand of a prepared delivery: only the delivery piece holds it. */
export const PREPARED: unique symbol = Symbol("provider-triggers.prepared-delivery")

/** What MATCH found for one agent: the registration that takes the event, else whether a `wait` of the agent lists its verb. */
export interface Match {
    /** The registration of the agent that takes the event, or null when none does. */
    readonly taker: TriggerTaker | null
    /** With no taker: whether a `wait` of one of the agent's workflows lists the verb (a parked run may take the event). */
    readonly listened: boolean
}

/** One event PREPARE kept: its data passed its schema, its files were kept, its person was met and every attached agent was matched. */
export interface PreparedEvent {
    /** The event as the commit hands it on (its files the ones PREPARE kept). */
    readonly given: DeliveredEvent
    /** The data its declaration's schema gave (what the same-fact key reads). */
    readonly data: Readonly<Record<string, unknown>>
    /** The generic trigger scope a graph reads. */
    readonly scope: EventScope
    /** The person's line the source reads from it, or null. */
    readonly said: DeclaredLine | null
    /** MATCH of every attached agent, in the agents' order. */
    readonly matches: ReadonlyMap<string, Match>
}

/** Whether the delivery may go on, as PREPARE read it (the switch is read again by the commit, on its own connection). */
export type PreparedGate = { readonly status: "open" } | { readonly status: "off" | "disconnected" }

/**
 * The prepared delivery of ONE event whose inbox row the receiver writes only after PREPARE (the one poll job prepares the row's admission
 * before the transaction that writes it): the row it was translated from, set on its event. Nothing PREPARE read depends on the row (the
 * row is read by the commit only: the same-fact claim and the wake's context), so the rest holds.
 */
export const preparedWithRaw = (prepared: PreparedDelivery, raw: DeliveredRaw): PreparedDelivery => ({
    ...prepared,
    events: prepared.events.map((one) => ({ ...one, given: { ...one.given, raw } })),
})

/** A delivery PREPARE made: everything the commit needs, read before any lock. */
export interface PreparedDelivery {
    readonly [PREPARED]: true
    /** What the source handed. */
    readonly input: DeliverInput
    /** The gate PREPARE found. */
    readonly gate: PreparedGate
    /** The agents MATCH asked, in a stable order. */
    readonly agents: ReadonlyArray<string>
    /** The events kept, in order. */
    readonly events: ReadonlyArray<PreparedEvent>
    /** Events PREPARE left out: an id that is no id, data its schema refuses, older than the switch's start point. */
    readonly dropped: number
}

/** A prepared delivery, or null where a source has nothing to deliver. */
export type OptionalPreparedDelivery = PreparedDelivery | null
