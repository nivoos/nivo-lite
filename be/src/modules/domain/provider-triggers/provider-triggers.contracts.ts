import type { TriggerVerb } from "@nivo-lite/agent-sdk/names"
import type { EntityManager } from "typeorm"
import type { CustomerAttachment } from "@modules/domain/chat-files"
import type { KeptFile } from "./trigger-delivery.policy"
import type { CanonicalEvent, TriggerDeclaration } from "./trigger-declaration.contracts"

/*
 * LEVEL 3 OF A PROVIDER: ITS TRIGGERS. A trigger is declared in code by its source as a `TriggerDeclaration` (trigger-declaration.contracts.ts:
 * the one shape: every way it is received, its words, its account switch, its pure translate); this file holds what the delivery, the
 * owner's switches and the registry reads say around it: the delivery's input and result, the switch's views and the readers the app binds.
 */

/** An agent id, or null where there is none. */
export type OptionalAgentId = string | null

/** The plain data a trigger's wake hands a run: the params, the trigger, the account and the agent's part. */
export interface WakeContext {
    /** One member of the plain data. */
    readonly [member: string]: unknown
}

/** What turning a switch asks. */
export interface SwitchRequest {
    /** On or off. */
    readonly enabled: boolean
    /** Turning on: start from where it last handed an event on (every event when it never did) instead of from now. */
    readonly catchUp?: boolean | undefined
}

/** The part an agent has in an event: it decides, or it is told. */
export type TriggerRole = "decider" | "notice"

/** The wake of one run a trigger starts, as the registration check and the tag door see it. */
export interface ProviderWake {
    /** `<provider>:<trigger>`. */
    readonly providerTrigger: string
    /** The account. */
    readonly connectionId: string
    /** The params the run reads: the payload fields (`each`) or `eventIds` and `count` (`list`). */
    readonly params: Readonly<Record<string, unknown>>
}

/** What the emit point asks the capability that owns the workflows. */
export interface ProviderTriggerReceivers {
    /** The agents attached to the account, in a stable order. */
    attachedTo(workspaceId: string, connectionId: string): Promise<ReadonlyArray<string>>
    /**
     * For each sample wake, whether an active workflow of the agent is registered on it and takes it (its filter holds), or a `wait` of
     * one lists its verb: the provider registry read's "which triggers this agent takes part in" (native-tools), no delivery.
     */
    registered(workspaceId: string, agentId: string, wakes: ReadonlyArray<ProviderWake>): Promise<ReadonlyArray<boolean>>
    /**
     * MATCH of the one event pipeline: the active workflow of the agent whose registration on `verb` takes an event with this generic
     * scope (`EventScope`), with the registration's own correlation key and settle time; null when none does.
     */
    takerOf(
        workspaceId: string,
        agentId: string,
        verb: TriggerVerb,
        scope: Readonly<Record<string, unknown>>,
        onlyWorkflowId?: string | null,
        /** A call's pin: only the registrations of the workflow of this key take it. */
        onlyWorkflowKey?: string | null,
    ): Promise<TriggerTaker | null>
    /**
     * Whether a `wait` step of an active workflow of the agent lists `verb`: then a run of it parked there may take an event no
     * registration of the agent takes (the waits come first: lane concept engine-core rule 8), so the event is delivered to it too.
     */
    waitsOn?(workspaceId: string, agentId: string, verb: TriggerVerb): Promise<boolean>
}

/** The registration that takes an event of the one event pipeline, as the delivery reads it. */
export interface TriggerTaker {
    /** The workflow whose registration takes it. */
    readonly workflowId: string
    /** The registration's own correlation key (a scope path), or null: then the declaration's key applies. */
    readonly ownKey: string | null
}

/** The files an event names at its source, for PREPARE to keep (`DeliveredEvent.attachments`). */
export interface EventAttachments {
    /** The id of the delivery job the keeping is an effect of (stable across its retries and resumes). */
    readonly keptUnder: string
    /** The event's own key (a channel's message key): the store's path of each file is made from it. */
    readonly key: string
    /** The files, in the order the source gave them. */
    readonly files: ReadonlyArray<CustomerAttachment>
}

/** The inbox row an event was translated from: its declared account data type and its id. */
export interface DeliveredRaw {
    readonly type: string
    readonly id: string
}

/** One event handed to the delivery (ROAD-API section 1.2). */
export interface DeliveredEvent {
    /** What the source's `translate` gave. */
    readonly event: CanonicalEvent
    /** The inbox row it was translated from (an account event); absent for a source with no row. */
    readonly raw?: DeliveredRaw | undefined
    /** The files the entry kept in the shop's store for it: the run reads them as `trigger.data.files`. */
    readonly files?: ReadonlyArray<KeptFile> | undefined
    /**
     * The files the event names AT ITS SOURCE (a channel's addresses, which may expire), for the pipeline to keep: PREPARE reads each once
     * and keeps its checked copy in the shop's store BEFORE any transaction (concept outbox-job rule 12: no outside call inside one), and
     * the commit hands the kept entries on as `files` (a file it could not keep is a typed not-kept entry, customer-messages rule 18). Each
     * file is one effect keyed by `keptUnder` (the delivery job's id: a retried or resumed job gets the entry kept the first time) and its
     * place; `key` is the event's own key the store's path is made from. A source gives this OR `files`, never both.
     */
    readonly attachments?: EventAttachments | undefined
    /** The person an engine source already knows (a timer armed in a run of a contact, a call's caller subject). */
    readonly contactId?: string | null | undefined
    /** The route an engine source already knows. */
    readonly routeId?: string | null | undefined
    /**
     * The SUBJECT an engine source declares for this one event (concept triggers rule 13: the trigger declares the subject): the scope
     * path its correlation key is read at (`contactId`, `routeId`, `data.<member>`), when the source's event is about something other
     * than its declaration's default (a team chat turn is about its room, `data.roomId`). A registration's own key still wins; absent or
     * not a legal path: the declaration's key.
     */
    readonly key?: string | null | undefined
    /** The member behind it (a team chat line), else null. */
    readonly actorMemberId?: string | null | undefined
    /** When it happened, ISO 8601; an account event older than its switch's start point is dropped. */
    readonly occurredAt?: string | undefined
    /**
     * The one workflow whose registration an engine source fired for (the clock: the workflow of the `agent_triggers` row that fired), so
     * an agent with two registrations of the verb (two presets) is matched by the row, never by the verb alone. Absent: MATCH by verb.
     */
    readonly workflowId?: string | null | undefined
    /**
     * The hand-off pin of a workflow call (`workflowCall` of the tag context today: the callee's workflow and version), written on the
     * wake as the run side reads it (`tagContext`), so the run goes to that workflow (a pinned call, not a match).
     */
    readonly pin?: { readonly workflow: string; readonly version: number | "latest" } | null | undefined
    /**
     * The provenance of a workflow call made by a run (`core.call-workflow`): the calling agent and run. The engine's call guards (depth,
     * cycle, duplicate, open to) and the hand-off's right to speak (`handedOffBy`) read it from the wake. Null for a person's start.
     */
    readonly caller?: { readonly agentId: string | null; readonly runId: string | null } | null | undefined
    /**
     * The run whose step wrote the data this event reports (a write event, concept agent-data rule 4) and its workflow: no registration of
     * that workflow starts on it (a workflow never starts itself by its own write) and the waits never offer it back to that run.
     */
    readonly writer?: { readonly runId: string; readonly workflowId: string | null } | null | undefined
}

/**
 * What a source hands the ONE delivery function: `ProviderTriggersService.prepare` (before any transaction), whose answer the entry commits
 * with `deliver` in its own transaction.
 */
export interface DeliverInput {
    /** The workspace of the proven connection, or of the engine source. */
    readonly workspaceId: string
    /** The source's declaration: the registered object of its (source, name). */
    readonly declaration: TriggerDeclaration
    /** The account the events came through (a website form: the site); null for a source of the engine with no account. */
    readonly connectionId: string | null
    /** The one agent an engine source is about; null for an account event (every agent attached to the account is asked). */
    readonly agentId: string | null
    /** The events, in order. */
    readonly events: ReadonlyArray<DeliveredEvent>
}

/** What came of one delivery. */
export type DeliverResult =
    | { readonly status: "off" | "disconnected" }
    | {
          readonly status: "delivered"
          /** Events handed on. */
          readonly events: number
          /** Events left out: an id that is no id, data its schema refuses, older than the switch's start point. */
          readonly dropped: number
          /**
           * Events that report a fact an earlier row of the workspace already reported (the declaration's `factKey`, owner R97): not handed
           * on, kept as their raw row with `same_fact_of`, counted here and logged once each; never silent.
           */
          readonly sameFact: number
          /** One entry per wake written. */
          readonly woken: ReadonlyArray<{ readonly agentId: string; readonly workflowId: string; readonly eventId: string; readonly wakeId: string }>
          /** Wakes that existed already: the same event delivered twice. */
          readonly repeats: number
          /** Events no live registration took: kept raw by the entry, nothing woken. */
          readonly untaken: number
          /**
           * Events about a person whose route a member of the shop holds (ruling R45): kept (inbox, the person's line) but correlated to
           * nothing, no run and no wait woken; the hand-back's one resume event answers them.
           */
          readonly held: number
      }

/** The switch of one trigger on one account, as the interface reads it. */
export interface TriggerSwitchView {
    /** The trigger name. */
    readonly name: string
    /** Whether it is on. */
    readonly enabled: boolean
    /** Since when it is on, ISO 8601; events older than this are not handed on. Null when off. */
    readonly enabledAt: string | null
    /** When it last handed an event on, ISO 8601, or null. */
    readonly lastFiredAt: string | null
    /** How many events it handed on. */
    readonly firedCount: number
    /** The agent the owner bound as the decider, or null (then the provider's core agent decides, where one is bound). */
    readonly deciderAgentId: string | null
}

/** Why a change of a switch or of a decider was refused. */
export type TriggerChangeRefusal = "undeclared" | "unknown_account" | "not_decided" | "core_decides" | "not_attached"

/** What a change came to. */
export type TriggerChangeResult = { readonly ok: true } | { readonly ok: false; readonly reason: TriggerChangeRefusal }

/** One agent as the trigger card names it. */
export interface TriggerAgentCard {
    /** The agent. */
    readonly id: string
    /** Its name. */
    readonly name: string
}

/**
 * What the trigger card asks the capability that owns the agents: the cards of some agents of a workspace (only those it knows). Bound
 * by the app; with none bound every agent name reads null and no binding choice is offered.
 */
export interface ProviderTriggerAgentNames {
    /** The agents of the workspace among `agentIds`, each with its name. */
    cardsOf(workspaceId: string, agentIds: ReadonlyArray<string>): Promise<ReadonlyArray<TriggerAgentCard>>
}

/** What the emit point's owner asks the providers: the agent a provider's own core path hands a trigger's events to. */
export interface ProviderTriggerCoreDeciders {
    /** The agent the core path hands the account's events of that trigger to, or null when it hands them to none. */
    coreDeciderOf(provider: string, trigger: string, connectionId: string): Promise<OptionalAgentId>
}

/**
 * What a provider's own core path reads of an account trigger: the agent the owner BOUND as its decider (the one column of the
 * account's switch row), whether the switch is on or off; null when nobody was bound or the owner never touched the trigger.
 */
export interface ProviderTriggerDeciderReader {
    /** The bound decider of the account's trigger, read on the caller's manager when it gives one. */
    boundDeciderOf(connectionId: string, trigger: string, manager?: EntityManager): Promise<OptionalAgentId>
}
