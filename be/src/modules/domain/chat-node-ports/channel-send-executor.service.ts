import { Injectable, Optional, type OnModuleInit } from "@nestjs/common"
import type { EffectCall } from "@nivo-lite/agent-sdk/node"
import { HOLDING_LINE_KEY_PREFIX } from "@nivo-lite/agent-sdk/customer-send"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { repeatableBySpec } from "@modules/domain/tool-specs"
import { refusalOf, type EffectFact, type EffectFacts } from "@nivo-lite/agent-sdk/node"
import { ChannelDeliveryService, ChannelsError, ChannelsErrorCode } from "@modules/domain/channels"
import { ConnectionsService } from "@modules/domain/connections"
import type { ContactIdentity } from "@modules/domain/contacts/contacts.contracts"
import { ContactsError } from "@modules/domain/contacts/errors/contacts.error"
import { ContactsService } from "@modules/domain/contacts/contacts.service"
import {
    ChannelDeliveriesService,
    CustomerMessagesService,
    CustomerRoutesService,
    type CustomerRoute,
    type StoredDelivery,
} from "@modules/domain/customer-routes"
// The error file, not the barrel: the barrel is half loaded here at decoration (an import ring), its enum read undefined.
import { EffectOutcomeUnknownCode, EffectOutcomeUnknownError } from "@modules/domain/graph-nodes/errors/graph-nodes.error"
import {
    GraphNodeRegistryService,
    callPlaceOf,
    type NodeEffectExecutor,
    type NodeEffectPayload,
    type NodeTurn,
} from "@modules/domain/graph-nodes"
import {
    AgentAccountsService,
    channelCapabilitiesOf,
    personAddressedChannels,
    providerOfChannel,
    seenAtStep,
    type RightVerdict,
    type SendJudged,
} from "@modules/domain/tools"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import {
    SEND_REFUSAL,
    outboundOf,
    placeholderRecipient,
    recipientRefused,
    sendRightOf,
    type ChannelSend,
    type ChannelVerdict,
    type CustomerMessageReceipt,
    type CustomerMessageSend,
    type SendRight,
} from "./chat-node-ports.policy"
import { customerMessageSendSchema } from "./chat-node-ports.schema"
import {
    attachmentSummaryOf,
    receiptOf,
    receiptOfRow,
    reachPicked,
    windowClosedAt,
    type Reach,
    type ReceiptPlace,
} from "./customer-send.policy"
import { ChatNodePortsLogEvent } from "./chat-node-ports.log-events"
import { ChatNodePortsError, ChatNodePortsErrorCode } from "./errors/chat-node-ports.error"

/** Who is speaking: the agent answering on the route it was woken on, or the shop writing unprompted (a care step, a message to another person or channel). */
type Speech = "reply" | "proactive"

/** The kind of the fact a sent message answers. */
const MESSAGE = "message"

/**
 * What a refusal does to the delivery ledger: `fresh` claims the key and settles it refused (the message was never tried); `claimed`
 * settles a key the send already claimed.
 */
type LedgerMode = "fresh" | "claimed"

/** How many of the route's newest lines a threading channel's reply is threaded under (the newest end of a long thread is what threads it). */
const THREAD_LINES = 20

/** The reason a delivery ledger row keeps when the provider's own busy answer stopped the attempt before anything went out. */
const CHANNEL_BUSY = "channel_busy"

/** Where a send goes once the person, the channel identity and the route are settled. */
interface Addressed {
    /** The person (current id). */
    readonly contactId: string
    /** What the notice to the owner calls them. */
    readonly name: string | null
    /** The channel identity reached. */
    readonly reach: Reach
    /** The route of the person on that entrance (empty only in a check that writes nothing, for a person with no route yet). */
    readonly routeId: string
    /** Reply on the route the run was woken on, or an unprompted message. */
    readonly speech: Speech
}

/** The account a person-level address goes through (rule SO-2), none bound, or several with no rule to pick one. */
type PersonAccount = { readonly kind: "account"; readonly accountId: string } | { readonly kind: "none" | "ambiguous" }

/** Why a send cannot go: the refusal reason and the facts that go with it. */
interface Stop {
    readonly reason: string
    readonly facts: Readonly<Record<string, string | null>>
}

/** The send as it goes out: the words, the card and the pictures (the `images` are the caller's, ten at most by the schema). */
interface Outgoing {
    /** What the channel is given. */
    readonly send: ChannelSend
    /** The once-key. */
    readonly key: string
    /** The words as the ledger keeps them. */
    readonly text: string
    /**
     * The step of the run the send was made in, as the run names it (`talk[r2].consult` inside a loop round, the node key elsewhere): read
     * from the step's call key (`<run>:<step>:<digest>`, the key the effect ledger files the same send under), else the node's key. The
     * step's "already told" read (`listByStep`) asks by the run's step key, so a round's sends are found in that round.
     */
    readonly stepKey: string | null
}

/** The rights verdict of a send as the channel's policy reads it (`ChannelVerdict`): the right concerned is the send tool itself. */
const channelVerdictOf = (verdict: RightVerdict | null, tool: string): ChannelVerdict | null =>
    verdict === null ? null : { ...verdict, ability: tool }

/** A receipt as the facts an answer carries (undefined members left out, so the facts are plain JSON). */
const factsOf = (receipt: CustomerMessageReceipt): EffectFacts => ({
    delivered: receipt.delivered,
    state: receipt.state,
    reason: receipt.reason,
    contactId: receipt.contactId,
    channel: receipt.channel,
    accountId: receipt.accountId,
    routeId: receipt.routeId,
    providerMessageId: receipt.providerMessageId,
    ...(receipt.via === undefined ? {} : { via: receipt.via }),
    at: receipt.at,
    sendKey: receipt.sendKey,
})

/**
 * Rule Q-3 (R74): the customer send declares itself `repeatable`, so a key whose attempt ENDED with an unknown outcome is claimed again
 * and sent under the same key when the step runs again (the worst case is a duplicate line); a key still in flight stays unknown.
 */
const sendRepeatable = (): boolean => repeatableBySpec(TOOL.customerMessageSend) === true

@Injectable()
/**
 * The one way a step's agent says something to a customer: the executor of `nivo.tool.customer.message.send`. A message addresses a
 * PERSON: the core contact (absent: the person the run serves), on a channel and account (absent: the route the run was woken on, else
 * the person's newest channel identity). The engine resolves the contact's channel identity and the route from its own rows and reads
 * and writes NO chatbot record: every attempt is a row of the engine's delivery ledger (`ChannelDeliveriesService`: the once-key is
 * claimed before the provider is asked and settled after; a key already delivered answers its earlier receipt, one in flight or ended
 * uncertain answers `unknown` and is never sent again by a machine). The answer is the delivery RECEIPT; the node writes its own line.
 *
 * Every rule is a refusal fact the agent reads (`{ kind: "refused", id, facts }`), never a throw: no person, no channel identity, another
 * agent keeping the route, the calling agent not attached to the account, a customer who opted out of unprompted messages, no
 * reachable recipient, Zalo's window closed (read from the stored inbound messages), the plan of the connection, a channel that
 * refused, and a member of the shop holding the route (the staff hold, ruling R43: only a member's typed reply goes). Whether a person approves the message first is
 * NOT decided here: it is the node's mode, asked by the tool door at the call like every other tool (rights rule 11: the approval card,
 * then the approved call is replayed once), so a send that reaches this executor is an `auto` one or an approved one, and the engine
 * keeps no draft of it. Only an infrastructure failure throws: the port's channel-neutral "nothing was sent, try later", so the
 * run engine tries again.
 */
export class ChannelSendExecutorService implements NodeEffectExecutor, OnModuleInit {
    /** The effect it runs. */
    readonly effect: string = TOOL.customerMessageSend

    constructor(
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
        private readonly contacts: ContactsService,
        private readonly routes: CustomerRoutesService,
        private readonly deliveries: ChannelDeliveriesService,
        private readonly delivery: ChannelDeliveryService,
        @Optional() private readonly registry?: GraphNodeRegistryService,
        @Optional() private readonly accounts?: AgentAccountsService,
        @Optional() private readonly connections?: ConnectionsService,
        @Optional() private readonly lines?: CustomerMessagesService,
    ) {}

    /** Registers the executor once the app has started. */
    onModuleInit(): void {
        this.registry?.addExecutor(this)
    }

    /**
     * The refusal `execute` would answer for this call right now, or null when it would send: the same rules in the same order (no
     * person or identity, a member of the shop holding the route, the connection gone, an opt-out, no attachment to the account, no linked
     * recipient, Zalo's window closed), judged without writing a route, a ledger row or an audit line and without asking the provider.
     * The tool door asks it before it raises a person's approval, so nobody approves a message that cannot go. A key already answered
     * in the ledger is no refusal here (`execute` replays its receipt).
     */
    async refusalFor(turn: NodeTurn, payload: NodeEffectPayload, call: EffectCall): Promise<EffectFact | null> {
        const given = customerMessageSendSchema.safeParse(payload)
        if (!given.success) return null
        const found = await this.addressed(turn, given.data, false)
        if ("refused" in found) return found.refused
        const key = call.dedupeKey ?? call.key
        const prior = await this.deliveries.byKey(turn.workspaceId, key)
        if (prior !== null && prior.state !== "refused") return null
        const stop = await this.stopOf(turn, found, call.key.startsWith(HOLDING_LINE_KEY_PREFIX), false, given.data.subject)
        if (stop === null) return null
        const receipt = receiptOf(placeOf(found), key, { state: "refused", reason: stop.reason })
        return { kind: "refused", id: stop.reason, facts: { ...factsOf(receipt), ...stop.facts } }
    }

    /** Says the message to the person the payload addresses; answers the delivery receipt, or why it was not sent. */
    async execute(turn: NodeTurn, payload: NodeEffectPayload, call: EffectCall): Promise<EffectFact> {
        const given = customerMessageSendSchema.safeParse(payload)
        if (!given.success) throw new ChatNodePortsError({ code: ChatNodePortsErrorCode.InvalidPayload })
        const asked = given.data
        const found = await this.addressed(turn, asked, true)
        if ("refused" in found) return this.refuse(turn, found.refused)
        const key = call.dedupeKey ?? call.key
        const prior = await this.deliveries.byKey(turn.workspaceId, key)
        // A key that ended unknown is sent again (rule Q-3: the send is repeatable); delivered or still in flight answers its row.
        if (prior !== null && prior.state !== "refused" && !(prior.state === "unknown" && sendRepeatable()))
            return this.settledAnswer(turn, prior)
        // A subject line goes only to a channel that declares one (rule SO-2); any other channel does not use it.
        const subject = channelCapabilitiesOf(found.reach.channel).subject === "none" ? undefined : asked.subject
        const send: ChannelSend = {
            text: asked.text,
            ...(subject === undefined ? {} : { subject }),
            ...(asked.order === undefined ? {} : { order: asked.order }),
            ...(asked.images === undefined || asked.images.length === 0 ? {} : { images: asked.images }),
        }
        const stepKey = stepKeyOf(turn, call)
        return this.say(turn, found, { send, key, text: asked.text, stepKey }, call.key.startsWith(HOLDING_LINE_KEY_PREFIX), asked.subject)
    }

    /**
     * The person, the channel identity and the route a payload addresses. A payload that names a ROUTE is addressed by it
     * (`addressedByRoute`). Else the person is the one named, else the one the run serves (the trigger's contact, else the one the woken
     * route belongs to); the identity is picked by the channel and account named, else the route the run was woken on, else the newest.
     * The route is made when the person has none on that entrance yet (`make`; a check that must write nothing only looks it up).
     */
    private async addressed(
        turn: NodeTurn,
        asked: CustomerMessageSend,
        make: boolean,
    ): Promise<Addressed | { readonly refused: EffectFact }> {
        const woken = turn.conversationId === null ? null : await this.routes.get(turn.workspaceId, turn.conversationId)
        if (asked.routeId !== undefined) return this.addressedByRoute(turn, asked.routeId, woken)
        if (asked.address !== undefined && asked.channel !== undefined)
            return this.addressedByAddress(turn, { channel: asked.channel, address: asked.address, accountId: asked.accountId }, woken, make)
        const contactId = asked.contactId ?? turn.contactId ?? woken?.contactId ?? null
        if (contactId === null) return { refused: refusalOf(SEND_REFUSAL.noRecipient) }
        const contact = await this.contacts.get(turn.workspaceId, contactId)
        if (contact === null) return { refused: refusalOf(SEND_REFUSAL.noRecipient, { contactId }) }
        const reachable = [...contact.identities, ...(await this.personReachOf(turn, contact.identities, asked, woken))]
        const picked = reachPicked(reachable, {
            channel: asked.channel,
            accountId: asked.accountId,
            woken: woken !== null && woken.contactId === contact.id ? { channel: woken.channel, accountId: woken.accountId } : null,
            chosen: await this.chosenOf(turn, reachable),
        })
        if (picked.kind !== "picked")
            return {
                refused: refusalOf(picked.reason, {
                    contactId: contact.id,
                    channel: asked.channel ?? null,
                    accountId: asked.accountId ?? null,
                    channels: [...picked.channels],
                }),
            }
        const { reach } = picked
        const entrance = { channel: reach.channel, accountId: reach.accountId }
        const routeId = make
            ? (await this.routes.ensure(turn.workspaceId, { contactId: contact.id, ...entrance })).routeId
            : ((await this.routes.find(turn.workspaceId, contact.id, entrance))?.id ?? "")
        return {
            contactId: contact.id,
            name: contact.displayName,
            reach,
            routeId,
            speech: routeId !== "" && this.isWoken(turn, woken, routeId) ? "reply" : "proactive",
        }
    }

    /**
     * A send addressed by a ROUTE (rule S-2): the route's person (a merged person answers its survivor), on the identity of the route's
     * own entrance (channel and account), on that very route. Everything after the address is the one send: holds, consent (an
     * unprompted message unless it is the run's woken route), rights, window, ledger. An unknown route, or one whose person is erased,
     * answers `no_recipient`; a person no longer known on the route's entrance, `no_channel_identity`.
     */
    private async addressedByRoute(
        turn: NodeTurn,
        routeId: string,
        woken: CustomerRoute | null,
    ): Promise<Addressed | { readonly refused: EffectFact }> {
        const route = await this.routes.get(turn.workspaceId, routeId)
        if (route === null) return { refused: refusalOf(SEND_REFUSAL.noRecipient, { routeId }) }
        const contact = await this.contacts.get(turn.workspaceId, route.contactId)
        if (contact === null) return { refused: refusalOf(SEND_REFUSAL.noRecipient, { routeId, contactId: route.contactId }) }
        const entrance = { channel: route.channel, accountId: route.accountId }
        const picked = reachPicked(contact.identities, {
            channel: route.channel,
            accountId: route.accountId ?? undefined,
            woken: entrance,
        })
        if (picked.kind !== "picked")
            return {
                refused: refusalOf(picked.reason, {
                    routeId,
                    contactId: contact.id,
                    channel: route.channel,
                    accountId: route.accountId,
                    channels: [...picked.channels],
                }),
            }
        return {
            contactId: contact.id,
            name: contact.displayName,
            reach: picked.reach,
            routeId: route.id,
            speech: this.isWoken(turn, woken, route.id) ? "reply" : "proactive",
        }
    }

    /**
     * A send addressed by a person's own ADDRESS on a channel (rule SO-3): only on a channel that reaches a person by a person-level
     * identity (`addressedBy`, a mail address); there the engine MEETS the person by it, as the pipeline's enrich meets a subject (the
     * contact holding it, else a new contact with it as a step-learned claim; a check that must write nothing only looks). The account is
     * the one named, else the woken route's on that channel, else the agent's binding (`personAccountOf`). Everything after is the one send.
     */
    private async addressedByAddress(
        turn: NodeTurn,
        asked: { readonly channel: string; readonly address: string; readonly accountId: string | undefined },
        woken: CustomerRoute | null,
        make: boolean,
    ): Promise<Addressed | { readonly refused: EffectFact }> {
        const { channel } = asked
        const kind = channelCapabilitiesOf(channel).addressedBy
        if (kind === "channel") return { refused: refusalOf(SEND_REFUSAL.addressNotAccepted, { channel }) }
        const met = await this.metAddress(turn.workspaceId, kind, asked.address, make)
        if (met === undefined) return { refused: refusalOf(SEND_REFUSAL.noRecipient, { channel }) }
        const account = await this.personAccountOf(turn, channel, asked.accountId, woken)
        if (account.kind !== "account")
            return {
                refused: refusalOf(account.kind === "none" ? SEND_REFUSAL.noChannelIdentity : SEND_REFUSAL.channelAmbiguous, {
                    contactId: met,
                    channel,
                    channels: [channel],
                }),
            }
        const reach: Reach = { channel, accountId: account.accountId, userId: asked.address.trim() }
        // A check before any write may not know the person yet: a new person holds no route, hold or consent to judge.
        if (met === null) return { contactId: "", name: null, reach, routeId: "", speech: "proactive" }
        const contact = await this.contacts.get(turn.workspaceId, met)
        const entrance = { channel, accountId: account.accountId }
        const routeId = make
            ? (await this.routes.ensure(turn.workspaceId, { contactId: met, ...entrance })).routeId
            : ((await this.routes.find(turn.workspaceId, met, entrance))?.id ?? "")
        return {
            contactId: met,
            name: contact?.displayName ?? null,
            reach,
            routeId,
            speech: routeId !== "" && this.isWoken(turn, woken, routeId) ? "reply" : "proactive",
        }
    }

    /** The contact an address stands for (null: nobody holds it yet, in a check that writes nothing); undefined for no valid address. */
    private async metAddress(workspaceId: string, kind: "email", address: string, make: boolean): Promise<string | null | undefined> {
        try {
            return await this.contacts.meetAddress(workspaceId, kind, address, make)
        } catch (cause) {
            if (cause instanceof ContactsError) return undefined
            throw cause
        }
    }

    /**
     * The person's reach on the channels addressed by a person-level identity (rule SO-2: a mail address reaches the person through any
     * of the workspace's mail accounts), as channel identities on the account the send goes through. Such a channel joins the person's
     * reach only when the call names it, the run was woken on a route of it, or the call names no channel and the person is known on no
     * per-account channel: a person reached on a chat is reached exactly as before. None without an account to go through.
     */
    private async personReachOf(
        turn: NodeTurn,
        identities: ReadonlyArray<ContactIdentity>,
        asked: CustomerMessageSend,
        woken: CustomerRoute | null,
    ): Promise<ReadonlyArray<ContactIdentity>> {
        const onChannels = identities.some((identity) => identity.kind === "channel")
        const reached: Array<ContactIdentity> = []
        for (const { channel, kind } of personAddressedChannels()) {
            const own = identities.filter((identity) => identity.kind === kind)
            const wanted = asked.channel === channel || woken?.channel === channel || (!onChannels && asked.channel === undefined)
            if (own.length === 0 || !wanted) continue
            const account = await this.personAccountOf(turn, channel, asked.channel === channel ? asked.accountId : undefined, woken)
            if (account.kind !== "account") continue
            reached.push(...own.map((identity) => ({ ...identity, kind: "channel" as const, provider: channel, account: account.accountId })))
        }
        return reached
    }

    /**
     * The account a person-level address goes through on a channel: the one the call names, else the woken route's when it is on that
     * channel, else the calling agent's BINDING for the send among the accounts of the channel's provider (`boundAccountsOf`: at a
     * workflow step the node's one bound account, picked by THE ONE ORDER; outside a step the only attached one, several = ambiguous).
     */
    private async personAccountOf(
        turn: NodeTurn,
        channel: string,
        named: string | undefined,
        woken: CustomerRoute | null,
    ): Promise<PersonAccount> {
        if (named !== undefined) return { kind: "account", accountId: named }
        if (woken !== null && woken.channel === channel && woken.accountId !== null) return { kind: "account", accountId: woken.accountId }
        const provider = providerOfChannel(channel)
        const { accounts } = this
        if (provider === null || accounts === undefined) return { kind: "none" }
        const seen = turn.step === undefined ? undefined : seenAtStep("node", turn.step)
        const bound = (await accounts.boundAccountsOf(turn.workspaceId, turn.agentId, this.effect, seen, { runId: turn.turnId })).filter(
            (account) => account.provider === provider,
        )
        const [only, ...more] = bound
        if (only === undefined) return { kind: "none" }
        return more.length === 0 ? { kind: "account", accountId: only.connectionId } : { kind: "ambiguous" }
    }

    /**
     * The accounts the sending step's node settings chose, in try order, that the agent is still attached to: read only for a send made
     * at a workflow step to a person reached on more than one channel identity (one identity leaves nothing to choose).
     */
    private async chosenOf(turn: NodeTurn, identities: ReadonlyArray<{ readonly kind: string }>): Promise<ReadonlyArray<string>> {
        const { accounts } = this
        const { step } = turn
        if (accounts === undefined || step === undefined) return []
        if (identities.filter((identity) => identity.kind === "channel").length < 2) return []
        const chosen = await accounts.chosenAccountsOf(turn.workspaceId, turn.agentId, seenAtStep("node", step))
        return chosen.map((account) => account.connectionId)
    }

    /** True when the route is the one the run was woken on. */
    private isWoken(turn: NodeTurn, woken: CustomerRoute | null, routeId: string): boolean {
        return turn.conversationId === routeId || woken?.id === routeId
    }

    /** The rules, then the claim and the push, then the receipt. */
    private async say(turn: NodeTurn, at: Addressed, out: Outgoing, engineLine: boolean, subject: string | undefined): Promise<EffectFact> {
        const stop = await this.stopOf(turn, at, engineLine, true, subject)
        if (stop !== null) return this.refusedOnRoute(turn, at, out, stop.reason, stop.facts)
        const claimed = await this.deliveries.claim(turn.workspaceId, this.claimOf(turn, at, out), sendRepeatable())
        if (claimed.verdict !== "send") return this.settledAnswer(turn, claimed.row)
        return this.pushed(turn, at, out)
    }

    /**
     * The rule that stops the send before anything is claimed, with the facts of why, or null when it may go: the one list of rules `say`
     * runs and `refusalFor` checks. `audited` files the rights verdict in the audit (a real send); a check does not.
     */
    private async stopOf(
        turn: NodeTurn,
        at: Addressed,
        engineLine: boolean,
        audited: boolean,
        subject: string | undefined,
    ): Promise<Stop | null> {
        // What the channel declares a message carries (rule SO-2): a channel whose messages carry a subject line takes none without one.
        if (channelCapabilitiesOf(at.reach.channel).subject === "required" && subject === undefined)
            return { reason: SEND_REFUSAL.subjectRequired, facts: { channel: at.reach.channel } }
        const rule = await this.ruleRefusal(turn, at)
        if (rule !== null) return { reason: rule, facts: {} }
        // An account that does not both receive and send on its channel is no entrance (rule MI-3): its port says which half it misses.
        const missing = await this.delivery.entranceOf(turn.workspaceId, at.reach.accountId)
        if (missing !== null) return { reason: SEND_REFUSAL.entranceIncomplete, facts: { accountId: at.reach.accountId, missing } }
        const right = await this.rightOf(turn, at, engineLine, audited)
        if (right.kind === "refused") return { reason: SEND_REFUSAL.channelNoAccess, facts: right.facts }
        if (this.unlinked(at.reach)) return { reason: SEND_REFUSAL.recipientNotLinked, facts: {} }
        if (await this.windowClosed(turn, at)) return { reason: SEND_REFUSAL.outsideWindow, facts: {} }
        return null
    }

    /**
     * The rule the send breaks before anything is claimed, or null when it may speak. The staff hold comes first (ruling R43): while a
     * member of the shop holds the route, every send that is not a member's typed reply (`turn.memberId`) is refused `route_held`, an
     * agent's step and the engine's holding line alike; the run reads the refusal as any refused send.
     */
    private async ruleRefusal(turn: NodeTurn, at: Addressed): Promise<string | null> {
        if (await this.heldFromAgents(turn, at)) return SEND_REFUSAL.routeHeld
        if (await this.connectionGone(turn, at.reach)) return SEND_REFUSAL.connectionMissing
        if (at.speech === "proactive" && (await this.optedOut(turn, at.contactId))) return SEND_REFUSAL.optedOut
        return null
    }

    /**
     * What the send may do on the identity's channel: the CALLING agent's attachment to the very account the person is reached through
     * (with two Zalo OAs, being attached to the other one is not enough), whoever's route it is (a hand-off lends the right to speak
     * there, not the attachment). The website chat goes through no provider and is no provider right. The node's mode is not judged here:
     * the tool door asked it at the call (rights rule 11), so a send that reaches this executor is an `auto` one or an approved one.
     */
    private async rightOf(turn: NodeTurn, at: Addressed, engineLine: boolean, audited: boolean): Promise<SendRight> {
        const provider = providerOfChannel(at.reach.channel)
        const { accounts } = this
        if (provider === null || accounts === undefined) return sendRightOf(null)
        const send = this.sendOf(turn, at, provider)
        const verdict = !audited
            ? await accounts.attachmentOf(send.workspaceId, send.agentId, send.effect, send.target)
            : engineLine
              ? await accounts.judgeEngineLine(send)
              : await accounts.judgeSend(send)
        return sendRightOf(channelVerdictOf(verdict, this.effect))
    }

    /** One send as the rights judge takes it: who speaks, the account reached, the turn's step, run and route. */
    private sendOf(turn: NodeTurn, at: Addressed, provider: string): SendJudged {
        return {
            workspaceId: turn.workspaceId,
            agentId: turn.agentId,
            effect: this.effect,
            target: { provider, connectionId: at.reach.accountId },
            step: turn.step,
            runId: turn.turnId,
            conversationId: at.routeId,
        }
    }

    /** Claims done: the provider is asked and the ledger settled with what it answered. */
    private async pushed(turn: NodeTurn, at: Addressed, out: Outgoing): Promise<EffectFact> {
        const { text, images } = outboundOf(out.send, at.reach.channel)
        const answers = await this.answersOf(turn, at)
        let receipt: Awaited<ReturnType<ChannelDeliveryService["deliverToPerson"]>>
        try {
            receipt = await this.delivery.deliverToPerson({
                workspaceId: turn.workspaceId,
                routeId: at.routeId,
                channel: at.reach.channel,
                accountId: at.reach.accountId,
                userId: at.reach.userId,
                sendKey: out.key,
                text,
                ...(out.send.subject === undefined ? {} : { subject: out.send.subject }),
                ...(answers.length === 0 ? {} : { answers }),
                windowChecked: true,
                ...(images.length === 0 ? {} : { images }),
            })
        } catch (cause) {
            if (cause instanceof ChannelsError && cause.code === ChannelsErrorCode.SendUnavailable) return this.notSent(turn, out, cause)
            throw cause
        }
        return this.answerOfPush(turn, at, out, receipt)
    }

    /**
     * The keys of the person's lines on the route the send answers, oldest first, for a channel that DECLARES it threads replies (rule
     * MI-5, `ChannelCapabilities.threads`): the newest lines of the route the person said, read from the engine's own store. None for any
     * other channel, a route not made yet, or an app with no store of the conversation.
     */
    private async answersOf(turn: NodeTurn, at: Addressed): Promise<ReadonlyArray<string>> {
        if (!channelCapabilitiesOf(at.reach.channel).threads || this.lines === undefined || at.routeId === "") return []
        const page = await this.lines.threadOf(turn.workspaceId, at.routeId, { limit: THREAD_LINES })
        return page.rows.filter((line) => line.direction === "from_person").map((line) => line.key).toReversed()
    }

    /**
     * The port's one channel-neutral "nothing was sent, try later" (rule QB-SEND): the key is settled refused (with the provider's word)
     * so the next try claims it again, and the call throws `DELIVERY_RATE_LIMITED`, which the runner's one classifier reads as transient:
     * the step parks on the retry ladder. The provider's asked wait rides along as a fact (`retryAfterSeconds`).
     */
    private async notSent(turn: NodeTurn, out: Outgoing, cause: ChannelsError): Promise<never> {
        const reason = typeof cause.params.reason === "string" ? cause.params.reason : CHANNEL_BUSY
        const wait = cause.params.retryAfterSeconds
        this.logger.warn(ChatNodePortsLogEvent.SendFailed, { turnId: turn.turnId, reason })
        await this.deliveries.mark(turn.workspaceId, out.key, { state: "refused", reason })
        throw new ChatNodePortsError({
            code: ChatNodePortsErrorCode.DeliveryRateLimited,
            params: { reason, ...(typeof wait === "number" ? { retryAfterSeconds: wait } : {}) },
            cause,
        })
    }

    /** What the provider's answer settles in the ledger (the key was claimed before the provider was asked) and the answer it makes. */
    private async answerOfPush(
        turn: NodeTurn,
        at: Addressed,
        out: Outgoing,
        receipt: Awaited<ReturnType<ChannelDeliveryService["deliverToPerson"]>>,
    ): Promise<EffectFact> {
        const place = placeOf(at)
        if (receipt.delivered) {
            const when = this.clock.now()
            await this.deliveries.mark(turn.workspaceId, out.key, { state: "delivered", providerMessageId: null, at: when })
            this.logger.info(ChatNodePortsLogEvent.Sent, { turnId: turn.turnId, sendKey: out.key, delivery: "delivered" })
            return this.message(
                receiptOf(place, out.key, { state: "delivered", reason: null, via: receipt.via, at: when.toISOString() }),
            )
        }
        if (receipt.outcome !== "rejected") {
            await this.deliveries.mark(turn.workspaceId, out.key, { state: "unknown", reason: null })
            this.logger.info(ChatNodePortsLogEvent.Sent, { turnId: turn.turnId, sendKey: out.key, delivery: "unknown" })
            return this.message(receiptOf(place, out.key, { state: "unknown", reason: "delivery_outcome_unknown" }))
        }
        const where = { failure: receipt.failure }
        if (receipt.failure === "channel_plan")
            return this.refusedOnRoute(turn, at, out, SEND_REFUSAL.planBlocked, where, "claimed")
        if (recipientRefused(receipt.failure))
            return this.refusedOnRoute(turn, at, out, SEND_REFUSAL.recipientNotLinked, where, "claimed")
        return this.refusedOnRoute(turn, at, out, SEND_REFUSAL.notDelivered, where, "claimed")
    }

    /**
     * Refuses on a route: the refusal is a ledger row of its own (claimed and settled refused, with the words that were not told), so the
     * thread shows what was not delivered and a later try of the same key may be claimed again. `claimed` settles a key a push already
     * claimed.
     */
    private async refusedOnRoute(
        turn: NodeTurn,
        at: Addressed,
        out: Outgoing,
        reason: string,
        extra: Readonly<Record<string, string | null>>,
        ledger: LedgerMode = "fresh",
    ): Promise<EffectFact> {
        if (ledger === "fresh") {
            const claimed = await this.deliveries.claim(turn.workspaceId, this.claimOf(turn, at, out), sendRepeatable())
            if (claimed.verdict !== "send") return this.settledAnswer(turn, claimed.row)
        }
        await this.deliveries.mark(turn.workspaceId, out.key, { state: "refused", reason })
        const receipt = receiptOf(placeOf(at), out.key, { state: "refused", reason })
        return this.refuse(turn, { kind: "refused", id: reason, facts: { ...factsOf(receipt), ...extra } })
    }

    /** The answer a ledger row stands for: the same receipt however often the key is asked; a key in flight or ended uncertain is `unknown`. */
    private settledAnswer(turn: NodeTurn, row: StoredDelivery): EffectFact {
        this.logger.info(ChatNodePortsLogEvent.Sent, { turnId: turn.turnId, sendKey: row.sendKey, delivery: row.state })
        return this.message(receiptOfRow(row))
    }

    /**
     * A message answer: the receipt is the fact. A receipt whose outcome nobody knows (the channel timed out or failed after the request
     * left, or the key is in flight or ended uncertain) is NEVER an answer (R74, item 6: it was handed back as a success and the node
     * went on as if it had spoken): the call ends in the typed outcome-unknown failure `delivery_outcome_unknown`, which the effect
     * ledger keeps (no machine calls again) and the step stops on for a person at once (`OUTCOME_UNKNOWN`). The ledger row keeps
     * `unknown`, so the line reads "outcome unknown".
     */
    private message(receipt: CustomerMessageReceipt): EffectFact {
        if (receipt.state === "unknown")
            throw new EffectOutcomeUnknownError({
                code: EffectOutcomeUnknownCode.Delivery,
                params: { effect: TOOL.customerMessageSend, sendKey: receipt.sendKey },
            })
        return { kind: MESSAGE, id: receipt.sendKey, facts: factsOf(receipt) }
    }

    /** The claim of the key: who tells what, to whom, on which route and entrance. */
    private claimOf(turn: NodeTurn, at: Addressed, out: Outgoing) {
        return {
            sendKey: out.key,
            routeId: at.routeId,
            contactId: at.contactId,
            agentId: turn.agentId,
            // A reply typed by a person (a job turn, no workflow step) has no run: only a step's send names its run.
            runId: turn.step === undefined ? null : turn.turnId,
            stepKey: out.stepKey,
            text: out.text,
            channel: at.reach.channel,
            accountId: at.reach.accountId,
            ...attachmentSummaryOf(out.send.images),
            // The core store keeps the line whole: its pictures by address, the order card, and the member who typed it.
            files: (out.send.images ?? []).map((image) => ({
                url: image.url,
                name: "",
                contentType: "",
                ...(image.caption === undefined ? {} : { caption: image.caption }),
            })),
            ...(out.send.order === undefined ? {} : { order: { ...out.send.order } }),
            memberId: turn.memberId ?? null,
        }
    }

    /** Logs a refusal (its reason, never the words) and answers it. */
    private refuse(turn: NodeTurn, fact: EffectFact): EffectFact {
        this.logger.info(ChatNodePortsLogEvent.Refused, { turnId: turn.turnId, reason: fact.id })
        return fact
    }

    /** True when a member of the shop holds the route and this send is no member's typed reply (a route not made yet is held by nobody). */
    private async heldFromAgents(turn: NodeTurn, at: Addressed): Promise<boolean> {
        if (at.routeId === "" || (turn.memberId ?? null) !== null) return false
        return (await this.routes.holdOf(turn.workspaceId, at.routeId)) !== null
    }

    /** True when the account the person is reached through is no connection the workspace still has (the website's account is a site, no connection). */
    private async connectionGone(turn: NodeTurn, reach: Reach): Promise<boolean> {
        if (reach.channel === "website") return false
        if (reach.accountId === "") return true
        if (this.connections === undefined) return false
        return (await this.connections.find(turn.workspaceId, reach.accountId)) === null
    }

    /**
     * True when the contact's ONE consent fact says the shop may not write to the person first (`ContactsService.consentOf`: set by a
     * person on the contact page, or by a step's call when the person asked to stop). Read only for a message the shop STARTS: an answer on
     * the route the run was woken on (`speech` "reply") never asks it.
     */
    private async optedOut(turn: NodeTurn, contactId: string): Promise<boolean> {
        // A person a check has not met yet (a new address) holds no consent fact.
        if (contactId === "") return false
        return (await this.contacts.consentOf(turn.workspaceId, contactId))?.doNotContact === true
    }

    /** True when the channel knows no recipient for the identity: no id on the channel, or an imported placeholder sender. */
    private unlinked(reach: Reach): boolean {
        return reach.userId === "" || placeholderRecipient({ channel: reach.channel, externalId: reach.userId })
    }

    /**
     * True when the customer last wrote longer ago than the reply window the channel DECLARES (`replyWindowMs`, rule SO-2; a channel that
     * declares none has no window). The start of the window is the person's last line on the route, read from the engine's own store of
     * the conversation (`CustomerMessagesService.lastHeardAt`: only what THEY said counts, a line the shop sent never opens the window); a
     * route the person never wrote on (or none yet) is open.
     */
    private async windowClosed(turn: NodeTurn, at: Addressed): Promise<boolean> {
        const window = channelCapabilitiesOf(at.reach.channel).replyWindowMs
        if (window === null || this.lines === undefined || at.routeId === "") return false
        const last = await this.lines.lastHeardAt(turn.workspaceId, at.routeId)
        return windowClosedAt(this.clock.now(), last, window)
    }
}

/** Where a message goes, for a receipt. */
/**
 * The run's step key of a step's send (MX-CORE observation (b): `customer_messages.step_key` held the node key `consult` while the run's step
 * is `talk[r2].consult`, so the step's own delivered-lines read never found a loop round's sends): the step of the call key when the key is
 * this run's step call key, else the node's key; null for a send of no workflow step (a person's typed reply).
 */
const stepKeyOf = (turn: NodeTurn, call: EffectCall): string | null => {
    if (turn.step === undefined) return null
    const place = callPlaceOf(call.key)
    return place !== null && place.runId === turn.turnId ? place.stepKey : turn.step.nodeKey
}

const placeOf = (at: Addressed): ReceiptPlace => ({
    contactId: at.contactId,
    channel: at.reach.channel,
    accountId: at.reach.accountId,
    routeId: at.routeId,
})
