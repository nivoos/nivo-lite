import { Injectable, Optional } from "@nestjs/common"
import { DEFAULT_TRIGGER_COMBINE, WORKFLOW_CALL_MEMBER, WORKFLOW_PARAMS_MEMBER } from "@nivo-lite/agent-sdk/graph"
import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { EntityManager } from "typeorm"
import type { AgentWakeContext } from "@modules/domain/agent-work"
// The policy file, not the barrel (as the door below): the combine modes a wake carries.
import { LATEST_COMBINE, STREAM_COMBINE } from "@modules/domain/agent-work/agent-wake-coalesce.policy"
// The door file, not the barrel: the barrel reaches back to this capability through its readers (no import ring at decoration).
import { AgentWakeService } from "@modules/domain/agent-work/agent-wake.service"
// The service file, not the barrel: the fact claim of the account data store.
import { AccountDataFactsService } from "@modules/domain/account-data/account-data-facts.service"
// The files of an event are kept by PREPARE, outside any transaction.
import { CustomerFilesService, partFileOf, unreadFileOf } from "@modules/domain/chat-files"
import { ConnectionBindingsReadService, actsAs, halvesOf } from "@modules/domain/connections"
// The service file, not the barrel: the barrel loads contacts-page.service, which reaches agent-work while it is half loaded (R37).
import { ContactsService } from "@modules/domain/contacts/contacts.service"
import { CustomerMessagesService, CustomerRoutesService } from "@modules/domain/customer-routes"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { PREPARED, type Match, type PreparedDelivery, type PreparedEvent, type PreparedGate } from "./prepared-delivery"
import { ProviderTriggerStoreService } from "./provider-trigger-store.service"
import type {
    DeliverInput,
    DeliverResult,
    DeliveredEvent,
    OptionalAgentId,
    ProviderTriggerCoreDeciders,
    ProviderTriggerReceivers,
    SwitchRequest,
    TriggerChangeResult,
    TriggerSwitchView,
} from "./provider-triggers.contracts"
import { InjectProviderTriggerCoreDeciders, InjectProviderTriggerReceivers } from "./provider-triggers.decorators"
import { ProviderTriggersLogEvent } from "./provider-triggers.log-events"
import { ProviderTriggersError, ProviderTriggersErrorCode } from "./errors/provider-triggers.error"
import type { DeclaredLine, TriggerDeclaration } from "./trigger-declaration.contracts"
import { combineOf, triggerDeclarations } from "./trigger-declarations.registry"
import {
    TRIGGER_WAKE_SOURCE,
    eventIdHolds,
    eventScopeOf,
    eventWakeKeyOf,
    keyPathOf,
    keyValueOf,
    ownKeyPathOf,
    scopeKeyOfEvent,
    type EventScope,
    type KeptFile,
} from "./trigger-delivery.policy"
import {
    canCatchUpOf,
    onByDefaultOf,
    switchDeclarationOf,
    switchableOf,
    switchedOn,
    type SwitchedDeclaration,
} from "./trigger-declarations.policy"

/** One event the commit hands on: prepared, and not the same fact as an earlier one. */
type Handed = PreparedEvent

type EventOutcome =
    | { readonly kind: "woken"; readonly agentId: string; readonly workflowId: string; readonly eventId: string; readonly wakeId: string }
    | { readonly kind: "repeat" }
    | { readonly kind: "untaken" }
    /** No registration of the agent takes it, but a `wait` of one of its workflows lists the verb: a parked run of it may take it. */
    | { readonly kind: "listened" }
    /** The event is about a person whose route a member of the shop holds (ruling R45): kept, correlated to nothing. */
    | { readonly kind: "held" }

/** The member of a call's tag context that names the calling run (as `core.call-workflow` writes it; agent-graphs reads it). */
const CALLER_MEMBER = "caller"

/** The account switch facts of a declaration, or null for a trigger with no switch (a customer channel: on while its account is). */
const switchOf = (declaration: TriggerDeclaration): SwitchedDeclaration | null =>
    switchDeclarationOf(declaration.provider, declaration.name)

const refused = (reason: Exclude<TriggerChangeResult, { ok: true }>["reason"]): TriggerChangeResult => ({ ok: false, reason })

/** True for an account event older than its switch's start point (left out: the owner switched the trigger on after it happened). */
const beforeStart = (given: DeliveredEvent, enabledAt: Date | null): boolean => {
    const at = given.occurredAt === undefined ? null : Date.parse(given.occurredAt)
    return enabledAt !== null && at !== null && !Number.isNaN(at) && at < enabledAt.getTime()
}

/** What the commit's first pass kept: the events handed on, the ones that were the same fact, the ones older than the start point. */
interface KeptEvents {
    readonly handed: ReadonlyArray<Handed>
    readonly sameFact: number
    readonly late: number
}

/** The switch of an account's trigger as one phase reads it: on (with its start point and row) or off. */
type SwitchRead = { readonly on: true; readonly enabledAt: Date | null; readonly rowId: string | null } | { readonly on: false }

@Injectable()
/**
 * THE ONE DELIVERY POINT of every trigger (`prepare` then `deliver`, lane concept triggers rule 13), and the switches of each account.
 * Every source's entry (a provider's webhook or poll after ITS signature check, the clock, a timer, the website form, the release door)
 * hands its canonical events to `prepare` BEFORE its transaction and commits the answer with `deliver` INSIDE it (concept outbox-job rule
 * 12: a transaction never waits for a second connection of its own pool, and does no outside work).
 */
export class ProviderTriggersService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
        private readonly store: ProviderTriggerStoreService,
        private readonly connections: ConnectionBindingsReadService,
        @Optional() @InjectProviderTriggerReceivers() private readonly receivers: ProviderTriggerReceivers | null = null,
        @Optional()
        @InjectProviderTriggerCoreDeciders()
        private readonly coreDeciders: ProviderTriggerCoreDeciders | null = null,
        @Optional() private readonly contacts?: ContactsService,
        @Optional() private readonly routes?: CustomerRoutesService,
        @Optional() private readonly wakes?: AgentWakeService,
        @Optional() private readonly lines?: CustomerMessagesService,
        @Optional() private readonly facts?: AccountDataFactsService,
        @Optional() private readonly files?: CustomerFilesService,
    ) {}

    /**
     * PREPARE, phase 1 of THE ONE DELIVERY FUNCTION (lane concept triggers rule 13; ROAD-API section 1.2). Called with NO transaction
     * open: everything here reads through the pool or acts outside NIVO, so none of it may run while a lock is held. The account (a
     * provider's: the workspace's, of the declaration's provider, not disconnected) and its switch (on, with its start point); for each
     * event: its id, its start point, its data against the declaration's schema, its files kept in the shop's store (`attachments`: read
     * once from the source, keyed by the delivery job), ENRICH for an event about a person (the contact the channel's own id names, else a
     * new one, and the person's route on the account, both made sure of: each its own short transaction); MATCH: for each agent attached
     * to the account (an engine source: the one agent it names), the active workflow whose registration takes the event, else whether a
     * `wait` of one lists its verb. Nothing it writes is part of the delivery (a contact and a route are made sure of whether or not the
     * delivery commits: the same person met again is the same contact), so an entry that prepares and then finds the event taken writes
     * nothing more.
     */
    async prepare(input: DeliverInput): Promise<PreparedDelivery> {
        const { declaration } = input
        if (!triggerDeclarations.isRegistered(declaration)) {
            throw new ProviderTriggersError({
                code: ProviderTriggersErrorCode.DeclarationUnknown,
                params: { trigger: `${declaration.provider}:${declaration.name}` },
            })
        }
        const gate = await this.gateOf(input)
        if (gate.status !== "open")
            return { [PREPARED]: true, input, gate: { status: gate.status }, agents: [], events: [], dropped: input.events.length }
        const kept: Array<Omit<PreparedEvent, "matches">> = []
        await eachInOrder(input.events, async (given) => {
            const read = await this.scopeOf(input, given, gate.enabledAt)
            if (read !== null) kept.push(read)
        })
        const agents = await this.agentsOf(input)
        const events: Array<PreparedEvent> = []
        await eachInOrder(kept, async (one) => {
            // MATCH every agent first: an event no registration of any agent takes is UNCLAIMED, and its wait-only wakes say so.
            const matches = new Map<string, Match>()
            await eachInOrder(agents, async (agentId) => {
                matches.set(agentId, await this.matchOf(input, one, agentId))
            })
            events.push({ ...one, matches })
        })
        const open: PreparedGate = { status: "open" }
        return { [PREPARED]: true, input, gate: open, agents, events, dropped: input.events.length - kept.length }
    }

    /**
     * PREPARE and COMMIT for a source that holds no lock of its own (a job that only delivers): prepared with no transaction open, then
     * committed in one transaction of its own.
     */
    async deliverAlone(input: DeliverInput): Promise<DeliverResult> {
        const prepared = await this.prepare(input)
        return this.entityManager.transaction((tx) => this.deliver(prepared, tx))
    }

    /**
     * COMMIT, phase 2 of THE ONE DELIVERY FUNCTION, in the caller's transaction (the entry's: its inbox row and the wakes commit together),
     * on that ONE connection only: nothing here reads through the pool or acts outside. The account's switch is read again (the owner may
     * have switched it off since PREPARE); per prepared event: THE SAME FACT (the fact key's claim under its advisory lock), the person's
     * line kept once on its route (the route's stream lock, then its `seq`), the staff hold of the route, then CORRELATE: one wake per
     * (agent, event) whose lock scope is the event's correlation key, with its combine (`stream` folds, `latest` replaces) under the wake
     * set's lock. The same event delivered twice writes nothing new (the wake's once-key). An event nobody takes wakes nothing (the entry
     * keeps it raw, as before).
     */
    async deliver(prepared: PreparedDelivery, tx: EntityManager): Promise<DeliverResult> {
        const { input } = prepared
        const { declaration, workspaceId, connectionId } = input
        if (prepared.gate.status !== "open") return { status: prepared.gate.status }
        const switched = await this.switchRead(input, tx)
        if (!switched.on) return { status: "off" }
        const { handed, sameFact, late } = await this.keptOf(prepared, switched.enabledAt, tx)
        const outcomes: Array<EventOutcome> = []
        let accepted = 0
        await eachInOrder(handed, async (one) => {
            // A held route costs no AI work (R45): the event is kept (its raw row, the person's line above) and counted as delivered,
            // but no agent is matched and no wait is woken; the hand-back delivers the one resume event that answers it.
            if (await this.heldRoute(input, one, tx)) {
                outcomes.push({ kind: "held" })
                accepted += 1
                return
            }
            let taken = false
            let repeated = false
            const unclaimed = [...one.matches.values()].every((match) => match.taker === null)
            await eachInOrder(prepared.agents, async (agentId) => {
                const match = one.matches.get(agentId) ?? { taker: null, listened: false }
                const outcome = await this.correlate(input, one, agentId, match, unclaimed, tx)
                if (outcome.kind !== "untaken") taken = true
                if (outcome.kind === "repeat") repeated = true
                if (outcome.kind !== "untaken") outcomes.push(outcome)
            })
            if (!taken) outcomes.push({ kind: "untaken" })
            // An event delivered again (its wake was written before) is no new firing.
            if (!repeated) accepted += 1
        })
        // The switch counts each accepted event once (not per registration, not a repeat): the Trigger tab's "last fired · N times" and
        // the start point of a `catchUp`. A switch with no row (its default) has nothing to count on, as before.
        if (switched.rowId !== null && accepted > 0) await this.store.markFired(tx, switched.rowId, this.clock.now(), accepted)
        const woken = outcomes.flatMap((outcome) =>
            outcome.kind === "woken"
                ? [{ agentId: outcome.agentId, workflowId: outcome.workflowId, eventId: outcome.eventId, wakeId: outcome.wakeId }]
                : [],
        )
        const result: DeliverResult = {
            status: "delivered",
            events: handed.length,
            dropped: prepared.dropped + late,
            sameFact,
            woken,
            repeats: outcomes.filter((outcome) => outcome.kind === "repeat").length,
            untaken: outcomes.filter((outcome) => outcome.kind === "untaken").length,
            held: outcomes.filter((outcome) => outcome.kind === "held").length,
        }
        this.logger.info(ProviderTriggersLogEvent.Delivered, {
            workspaceId,
            connectionId: connectionId ?? "",
            provider: declaration.provider,
            trigger: declaration.name,
            verb: declaration.verb,
            events: result.events,
            dropped: result.dropped,
            sameFact: result.sameFact,
            woken: woken.length,
            repeats: result.repeats,
            untaken: result.untaken,
            held: result.held,
        })
        return result
    }

    /**
     * The commit's first pass over the prepared events: an event older than the switch's start point (read again here) is left out; THE
     * SAME FACT (owner R97), before any line or wake: the first report of a fact goes on, a later one is kept as its raw row
     * (`same_fact_of`) and counted, never handed on and never silent; a person's message is kept on its route ONCE per event, before any
     * agent is matched (R26): whether or not a wait or a registration takes it, the conversation holds what the person said.
     */
    private async keptOf(prepared: PreparedDelivery, enabledAt: Date | null, tx: EntityManager): Promise<KeptEvents> {
        const { input } = prepared
        const handed: Array<Handed> = []
        let sameFact = 0
        let late = 0
        await eachInOrder(prepared.events, async (one) => {
            if (beforeStart(one.given, enabledAt)) {
                late += 1
                return
            }
            if (await this.sameFactAsEarlier(input, one.given, one.data, tx)) {
                sameFact += 1
                return
            }
            handed.push(one)
            await this.heard(input, one.given, one, tx)
        })
        return { handed, sameFact, late }
    }

    /**
     * True for an event ABOUT A PERSON (its `subject`: a channel identity) whose route a member of the shop holds now (the staff hold on
     * `customer_routes`, R43/R45). Generic: keyed on the route the engine met, nothing about chat. Any other event (no subject: a bank
     * credit, a timer, a call) flows as usual; so does every event in an app with no routes. The hold is read in the delivery's own
     * transaction: a hand-back that clears the hold and delivers its resume event in one transaction (R51 item 3) is not held by itself.
     */
    private async heldRoute(input: DeliverInput, one: Handed, tx: EntityManager): Promise<boolean> {
        const routeId = one.scope.routeId
        if (one.given.event.subject === undefined || routeId === undefined || this.routes === undefined) return false
        const hold = await this.routes.holdOf(input.workspaceId, routeId, tx)
        if (typeof hold?.memberId !== "string") return false
        this.logger.info(ProviderTriggersLogEvent.RouteHeld, {
            workspaceId: input.workspaceId,
            routeId,
            verb: input.declaration.verb,
            eventId: one.scope.eventId,
        })
        return true
    }

    /**
     * PREPARE's gate: an account of a provider must be the workspace's, of that provider and not disconnected; a provider trigger with an
     * account switch must be switched on (with its start point). A source of NIVO itself (`nivo`: the clock, a timer, the website form,
     * the team chat) has no connection to prove. Read through the pool: no transaction is open.
     */
    private async gateOf(
        input: DeliverInput,
    ): Promise<{ readonly status: "open"; readonly enabledAt: Date | null } | { readonly status: "off" | "disconnected" }> {
        const { declaration, connectionId } = input
        const switched = await this.switchRead(input, this.entityManager)
        if (!switched.on) return { status: "off" }
        if (connectionId === null || declaration.provider === PROVIDER.nivo) return { status: "open", enabledAt: null }
        const account = await this.connections.recordOf(input.workspaceId, connectionId)
        // The account is the declaration's provider's, or holds that provider's half (a mailbox `smtp` account holds its `imap` inbound half).
        if (account === null || !actsAs(account, declaration.provider) || account.status === "disconnected") return { status: "disconnected" }
        return { status: "open", enabledAt: switched.enabledAt }
    }

    /**
     * The account's switch of the trigger, on `manager` (the pool in PREPARE, the commit's own transaction in COMMIT): a trigger with no
     * switch, or a source with no account, is always on.
     */
    private async switchRead(input: DeliverInput, manager: EntityManager): Promise<SwitchRead> {
        const { declaration, connectionId } = input
        if (connectionId === null || declaration.provider === PROVIDER.nivo) return { on: true, enabledAt: null, rowId: null }
        const switchFacts = switchOf(declaration)
        if (switchFacts === null) return { on: true, enabledAt: null, rowId: null }
        const held = await this.store.find(manager, connectionId, declaration.name)
        if (!switchedOn(held, switchFacts) || (held !== null && held.workspaceId !== input.workspaceId)) return { on: false }
        return { on: true, enabledAt: held?.enabledAt ?? null, rowId: held?.id ?? null }
    }

    /**
     * What PREPARE keeps of one event, or null when it is left out: an id that is no id, data its declaration's schema refuses, or an
     * event older than its switch's start point. Its files are kept (read once from the source, outside any transaction), and an event
     * about a person is ENRICHED: the contact the channel's own id of them names (a new one, named as the channel shows them, when none
     * does) and their route on the account, both made sure of.
     */
    private async scopeOf(
        input: DeliverInput,
        source: DeliveredEvent,
        enabledAt: Date | null,
    ): Promise<Omit<PreparedEvent, "matches"> | null> {
        const { event } = source
        if (!eventIdHolds(event.id)) return null
        if (beforeStart(source, enabledAt)) return null
        const parsed = input.declaration.data.safeParse(event.data)
        if (!parsed.success) return null
        const given = await this.withKeptFiles(input, source)
        const data: Readonly<Record<string, unknown>> = { ...parsed.data }
        const person = await this.personOf(input, given)
        const scope = eventScopeOf({
            eventId: event.id,
            accountId: input.connectionId,
            contactId: person.contactId,
            routeId: person.routeId,
            data,
            files: given.files ?? [],
        })
        // The source's pure reading of the event as a person's message, on the PARSED data (null: this event is none, or it feeds no lines).
        const { feeds } = input.declaration
        return { given, data, scope, said: feeds?.stream === "lines" ? feeds.line(parsed.data) : null }
    }

    /**
     * The event with the files it names at its source kept in the shop's store (`attachments`, generic for every source that hands
     * files): each read ONCE from the source and copied, as one effect keyed by the delivery job and the file's place, so a retried job
     * keeps the entry of the first time. Never inside a transaction. With no file store in the app every file is a typed not-kept entry
     * (`no_store`), never an address that is not there.
     */
    private async withKeptFiles(input: DeliverInput, given: DeliveredEvent): Promise<DeliveredEvent> {
        const attachments = given.attachments
        if (attachments === undefined || attachments.files.length === 0) return given
        const kept: ReadonlyArray<KeptFile> =
            this.files === undefined
                ? attachments.files.map((file, index) =>
                      file.contentType === undefined
                          ? unreadFileOf(index, file.kind, file.name, "no_store")
                          : partFileOf(index, file.contentType, file.name),
                  )
                : await this.files.keep({ jobId: attachments.keptUnder }, input.workspaceId, attachments.key, attachments.files)
        return { ...given, attachments: undefined, ...(kept.length === 0 ? {} : { files: kept }) }
    }

    /**
     * Whether the event reports a fact an earlier row of the workspace already reported: only for a declaration with a `factKey`, an event
     * with its raw row and a key the source gives; the key is `<verb>:<factKey>` (two providers on one verb meet). Any other event goes on as
     * before. In the commit's transaction (the claim's advisory lock is its own).
     */
    private async sameFactAsEarlier(
        input: DeliverInput,
        given: DeliveredEvent,
        data: Readonly<Record<string, unknown>>,
        tx: EntityManager,
    ): Promise<boolean> {
        const { declaration } = input
        const key = declaration.factKey?.(data) ?? null
        if (this.facts === undefined || key === null || given.raw === undefined) return false
        const claim = await this.facts.claim(tx, {
            workspaceId: input.workspaceId,
            type: given.raw.type,
            id: given.raw.id,
            factKey: `${declaration.verb}:${key}`,
        })
        if (claim.first) return false
        this.logger.info(ProviderTriggersLogEvent.SameFact, {
            workspaceId: input.workspaceId,
            verb: declaration.verb,
            eventId: given.event.id,
            earlierRowId: claim.sameAs.id,
        })
        return true
    }

    /**
     * Keeps a person's message on its route (`CustomerMessagesService.hear`, insert-or-nothing per route and the source's key, the route's
     * stream lock before its `seq`): an event about a channel identity (`subject`) whose declaration reads a line from it. The same event
     * delivered twice keeps one line.
     */
    private async heard(
        input: DeliverInput,
        given: DeliveredEvent,
        read: { readonly scope: EventScope; readonly said: DeclaredLine | null },
        tx: EntityManager,
    ): Promise<void> {
        const { subject } = given.event
        const { said, scope } = read
        if (this.lines === undefined || subject === undefined || said === null || said.key === "") return
        if (scope.routeId === undefined || scope.contactId === undefined) return
        // A line is a message with ANY content part: its words, or a file the event named (kept, or typed not-kept). One with neither is
        // no line (customer-messages rule 18; D3-W2-9).
        if (said.text.trim() === "" && (given.files ?? []).length === 0) return
        await this.lines.hear(tx, {
            workspaceId: input.workspaceId,
            routeId: scope.routeId,
            contactId: scope.contactId,
            channel: subject.channel,
            accountId: input.connectionId,
            key: said.key,
            text: said.text,
            at: said.at ?? given.occurredAt ?? null,
            files: given.files ?? [],
            eventId: given.event.id,
        })
    }

    /** ENRICH (PREPARE): the person of an event with a subject (met, and their route ensured), else the one an engine source names. */
    private async personOf(
        input: DeliverInput,
        given: DeliveredEvent,
    ): Promise<{ readonly contactId: string | null; readonly routeId: string | null }> {
        const { subject } = given.event
        const { connectionId, workspaceId } = input
        if (subject === undefined || connectionId === null || this.contacts === undefined || this.routes === undefined)
            return { contactId: given.contactId ?? null, routeId: given.routeId ?? null }
        // A person-level identity (a mail address) is met as the person's own address, the same person on every account; any other
        // subject is the channel's own id of the person on this account.
        const contactId =
            subject.identity === undefined
                ? await this.contacts.meetChannel(workspaceId, {
                      channel: subject.channel,
                      account: connectionId,
                      userId: subject.id,
                      name: subject.name ?? null,
                  })
                : await this.contacts.meetAddress(workspaceId, subject.identity, subject.id, true, subject.name ?? null)
        // Met with `make`: a contact always answers (null only when a look that writes nothing finds none).
        if (contactId === null) return { contactId: null, routeId: null }
        const { routeId } = await this.routes.ensure(workspaceId, { contactId, channel: subject.channel, accountId: connectionId })
        return { contactId, routeId }
    }

    /** The agents MATCH asks (PREPARE): the one an engine source names, else every agent attached to the account, each once. */
    private async agentsOf(input: DeliverInput): Promise<ReadonlyArray<string>> {
        if (input.agentId !== null) return [input.agentId]
        if (input.connectionId === null || this.receivers === null) return []
        return [...new Set(await this.receivers.attachedTo(input.workspaceId, input.connectionId))]
    }

    /**
     * MATCH of one event for one agent (PREPARE): the workflow whose registration takes it, else whether a `wait` of one of its workflows
     * lists the verb (a run parked there may take it; with none the drain ends it). The clock's firing names its workflow, so it is never
     * heard by a wait. Read only.
     */
    private async matchOf(input: DeliverInput, one: Omit<PreparedEvent, "matches">, agentId: string): Promise<Match> {
        const { declaration } = input
        const pin = one.given.pin ?? null
        const taker =
            (await this.receivers?.takerOf(
                input.workspaceId,
                agentId,
                declaration.verb,
                { ...one.scope },
                one.given.workflowId ?? null,
                pin?.workflow ?? null,
            )) ?? null
        const listened =
            taker === null &&
            (one.given.workflowId ?? null) === null &&
            pin === null &&
            (await this.receivers?.waitsOn?.(input.workspaceId, agentId, declaration.verb)) === true
        return { taker, listened }
    }


    /**
     * CORRELATE of one matched event for one agent: one wake keyed once by the verb, the origin and the event's id, locked by the event's
     * correlation key (the registration's own, else the declaration's), with the registration's settle time. Ids only ride on the wake:
     * the data is rebuilt from the raw row when the run starts. A wait-only wake of an event no agent's registration took is marked
     * `unclaimed`.
     */
    private async correlate(
        input: DeliverInput,
        one: Handed,
        agentId: string,
        match: Match,
        unclaimed: boolean,
        tx: EntityManager,
    ): Promise<EventOutcome> {
        const { declaration } = input
        const { listened } = match
        // A workflow never starts on an event its own run wrote (concept agent-data rule 4): its registration does not take it.
        const writer = one.given.writer ?? null
        const taker = match.taker !== null && writer !== null && match.taker.workflowId === writer.workflowId ? null : match.taker
        if (this.wakes === undefined) return { kind: "untaken" }
        if (taker === null && !listened) return { kind: "untaken" }
        // The subject: the registration's own key, else the one the source declares for this event, else the declaration's default.
        const keyPath = ownKeyPathOf(taker?.ownKey ?? null) ?? ownKeyPathOf(one.given.key ?? null) ?? keyPathOf(declaration.key)
        const keyValue = keyPath === null ? null : keyValueOf(one.scope, keyPath)
        const origin = input.connectionId ?? agentId
        const written = await this.wakes.write(tx, {
            workspaceId: input.workspaceId,
            agentId,
            source: TRIGGER_WAKE_SOURCE,
            eventKey: eventWakeKeyOf(declaration.verb, origin, one.scope.eventId),
            context: this.contextOf(input, one, taker?.workflowId ?? null, keyValue === null ? null : keyPath, unclaimed),
            actorMemberId: one.given.actorMemberId ?? null,
            scopeKey: scopeKeyOfEvent(keyPath, keyValue),
            // The settle time is the SOURCE's (its declaration: a chat line a few seconds, capped; every other source zero).
            ...(declaration.settle === undefined || declaration.settle === null ? {} : { settle: declaration.settle }),
        })
        if (written === null) return { kind: "repeat" }
        // Rule Q-4 (QB-P5 C-2): a wake of a `stream` declaration is ONE marker with the un-run wakes of its set: the oldest stays, this one is
        // closed `coalesced:<marker>` at once when an older one waits. Written first, so its once-key holds a redelivery to one row.
        // Rule Q-4 `latest` (QB-LATEST): the wake just written replaces every other un-run wake of its set (each closed `replaced:<it>`).
        const set = {
            workspaceId: input.workspaceId,
            agentId,
            scopeKey: scopeKeyOfEvent(keyPath, keyValue),
            declaration: `${declaration.provider}:${declaration.name}`,
            workflowId: taker?.workflowId ?? null,
        }
        if (combineOf(declaration) === STREAM_COMBINE) await this.wakes.coalesce(tx, set)
        if (combineOf(declaration) === LATEST_COMBINE) await this.wakes.replaceOlder(tx, set, written)
        return taker === null
            ? { kind: "listened" }
            : { kind: "woken", agentId, workflowId: taker.workflowId, eventId: one.scope.eventId, wakeId: written }
    }

    /**
     * The ids a wake of the pipeline carries (ROAD-API section 3.2): the verb, the event, the declaration, the workflow that took it, the
     * key it is locked by, the account, the person and the route (`conversationId`: the engine's own name of the route, which holds and stops
     * are keyed by), the raw row its data is rebuilt from, else the data itself for a source that keeps no row, and the files.
     */
    private contextOf(
        input: DeliverInput,
        one: Handed,
        workflowId: string | null,
        keyPath: string | null,
        unclaimed: boolean,
    ): AgentWakeContext {
        const { declaration, connectionId } = input
        const { scope, given } = one
        return {
            verb: declaration.verb,
            eventId: scope.eventId,
            declaration: `${declaration.provider}:${declaration.name}`,
            // A wake no registration took names no workflow: only a parked `wait` may take it (`listened`).
            ...(workflowId === null ? { waitOnly: "true" as const } : { workflowId }),
            ...(workflowId === null && unclaimed ? { unclaimed: "true" as const } : {}),
            // How the declaration's pending events combine (rule Q-4); absent = `each`.
            ...(combineOf(declaration) === DEFAULT_TRIGGER_COMBINE ? {} : { combine: combineOf(declaration) }),
            ...(keyPath === null ? {} : { keyPath }),
            ...(connectionId === null ? {} : { connectionId }),
            ...(scope.contactId === undefined ? {} : { contactId: scope.contactId }),
            ...(scope.routeId === undefined ? {} : { conversationId: scope.routeId }),
            ...(given.writer == null ? {} : { writerRunId: given.writer.runId }),
            ...(given.raw === undefined
                ? { dataJson: JSON.stringify(given.event.data) }
                : { rawType: given.raw.type, rawRowId: given.raw.id }),
            ...(given.files === undefined || given.files.length === 0 ? {} : { filesJson: JSON.stringify(given.files) }),
            ...this.callContextOf(given),
        }
    }

    /**
     * What a workflow call's wake carries beside its ids (the pin routes it; the engine's call guards and the hand-off's right to speak
     * read the rest): `tagContext = { workflowCall, params, caller? }` in the shape `core.call-workflow` always wrote, and the calling
     * agent as `authorAgentId`. Nothing for an event that is no call.
     */
    private callContextOf(given: DeliveredEvent): Pick<AgentWakeContext, "tagContext" | "authorAgentId"> {
        const pin = given.pin ?? null
        if (pin === null) return {}
        const caller = given.caller ?? null
        const tagContext = JSON.stringify({
            [WORKFLOW_CALL_MEMBER]: pin,
            [WORKFLOW_PARAMS_MEMBER]: given.event.data,
            ...(caller?.runId == null ? {} : { [CALLER_MEMBER]: { runId: caller.runId } }),
        })
        return { tagContext, ...(caller?.agentId == null ? {} : { authorAgentId: caller.agentId }) }
    }

    /**
     * Whether the account's switch of the trigger is on: the one read a provider makes before any work of its own for the trigger. With no
     * switch set, the trigger's default (`onByDefault`, the same for every provider that declares the name).
     */
    async isOn(connectionId: string, trigger: string, manager: EntityManager = this.entityManager): Promise<boolean> {
        const held = await this.store.find(manager, connectionId, trigger)
        return held === null ? onByDefaultOf(trigger) : held.enabled === true
    }

    /** The switches of one account: one per trigger its provider declares; where the owner never touched one, its default (off but rule 6a). */
    async switchesOf(workspaceId: string, connectionId: string): Promise<ReadonlyArray<TriggerSwitchView>> {
        const account = await this.connections.recordOf(workspaceId, connectionId)
        if (account === null) return []
        const held = new Map((await this.store.listOf(workspaceId, connectionId)).map((row) => [row.triggerName, row]))
        // The account's own provider's triggers and those of every half it holds (a mailbox's inbound half: `imap`).
        return [account.provider, ...halvesOf(account)].flatMap((provider) => switchableOf(provider)).map((declaration) => {
            const row = held.get(declaration.name)
            return {
                name: declaration.name,
                enabled: switchedOn(row, declaration),
                enabledAt: row?.enabled === true ? (row.enabledAt?.toISOString() ?? null) : null,
                lastFiredAt: row?.lastFiredAt?.toISOString() ?? null,
                firedCount: row?.firedCount ?? 0,
                deciderAgentId: row?.deciderAgentId ?? null,
            }
        })
    }

    /**
     * Turns the trigger of an account on or off (the caller proved the person may). Turning it on sets the start point: now, or with
     * `catchUp` the moment it last handed an event on (every event when it never did), so what the provider's recovery brings back
     * from the time it was off is taken. A trigger whose provider recovers no missed event cannot catch up: it starts from now.
     */
    async setEnabled(
        workspaceId: string,
        connectionId: string,
        trigger: string,
        change: SwitchRequest,
    ): Promise<TriggerChangeResult> {
        const declaration = await this.declaredOn(workspaceId, connectionId, trigger)
        if (typeof declaration === "string") return refused(declaration)
        if (!change.enabled) {
            await this.store.change(workspaceId, connectionId, trigger, { enabled: false })
            return { ok: true }
        }
        const held = await this.store.find(this.entityManager, connectionId, trigger)
        const catchUp = change.catchUp === true && canCatchUpOf(declaration)
        const enabledAt = catchUp ? (held?.lastFiredAt ?? null) : this.clock.now()
        await this.store.change(workspaceId, connectionId, trigger, { enabled: true, enabledAt })
        return { ok: true }
    }

    /**
     * Binds the agent that decides on an account's trigger, or unbinds it with null (the caller proved the person may). Refused for a
     * trigger nobody decides on, for an agent that is not attached to the account, and while the provider's own core path hands the
     * account's events to an agent: that agent decides until its binding is removed, so one account trigger never has two deciders.
     */
    async bindDecider(
        workspaceId: string,
        connectionId: string,
        trigger: string,
        agentId: OptionalAgentId,
    ): Promise<TriggerChangeResult> {
        const declaration = await this.declaredOn(workspaceId, connectionId, trigger)
        if (typeof declaration === "string") return refused(declaration)
        if (!declaration.switch.decided) return refused("not_decided")
        if (agentId !== null) {
            const core = await this.coreDeciders?.coreDeciderOf(declaration.provider, trigger, connectionId)
            if (core != null) return refused("core_decides")
            const attached = (await this.receivers?.attachedTo(workspaceId, connectionId)) ?? []
            if (!attached.includes(agentId)) return refused("not_attached")
        }
        await this.store.change(workspaceId, connectionId, trigger, { deciderAgentId: agentId })
        return { ok: true }
    }

    /** The declaration of a trigger on an account of the workspace, or why there is none. */
    private async declaredOn(
        workspaceId: string,
        connectionId: string,
        trigger: string,
    ): Promise<SwitchedDeclaration | "unknown_account" | "undeclared"> {
        const account = await this.connections.recordOf(workspaceId, connectionId)
        if (account === null) return "unknown_account"
        const declared = [account.provider, ...halvesOf(account)].map((provider) => switchDeclarationOf(provider, trigger)).find((one) => one !== null)
        return declared ?? "undeclared"
    }
}
