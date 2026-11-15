import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AgentBindingsService } from "@modules/domain/agent-connections"
import { ApiKeyOwnerService } from "@modules/domain/api-keys"
import { EventsService } from "@modules/domain/events"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { PublicApiError, PublicApiErrorCode } from "./errors/public-api.error"
import type { MessageRequestBody, PendingMessageDelivery } from "./public-api.contracts"
import { PublicApiLogEvent } from "./public-api.log-events"
import { isStaleMessageAdmission } from "./public-api.policy"
import { PublicConversationsService, type PublicConversationRef } from "./public-conversations.service"
import { PublicMessageHoldsService, type HeldReason } from "./public-message-holds.service"

/** What a send may change from the public door's default: the key its send is made once under, and whether the message's evidence is recorded. */
export interface FulfillOptions {
    /** The send's key; absent takes `api.message:<request>`. */
    readonly dedupeKey?: string
    /** Whether the evidence of the message is recorded; absent records it. */
    readonly recordEvidence?: boolean
}

/** What PREPARE read of an admitted message, before the fence: its conversation, its sender and whether it is held (and why). */
export interface PreparedMessage {
    /** The customer conversation (the route) the message is for. */
    readonly conversation: PublicConversationRef
    /** The agent that tells it. */
    readonly agentId: string
    /** Why it is held (its report already posted), or null when it is sent. */
    readonly held: HeldReason | null
}

/** A prepared message, or null where a request carries none. */
export type OptionalPreparedMessage = PreparedMessage | null

/** Why an admitted message is held: the caller asked for an approval, or it waited past its auto-send window; null when it is sent. */
const heldReasonOf = (requireApproval: boolean, stale: boolean): HeldReason | null => {
    if (requireApproval) return "approval_asked"
    return stale ? "stale" : null
}

@Injectable()
/**
 * Turns an admitted API message into a send owed to the person of its ROUTE: the sender is the API key's agent while it exists in the
 * workspace, else the front door that answers the route's entrance (else the workspace's installed front door, else the typed refusal
 * of the key's owner lookup: customer-messages rule 10). No chat line is stored. PREPARE reads all of that (and posts a hold's report)
 * before the caller's fence; inside the caller's domain transaction it only records the evidence; the send to the channel is the caller's, after commit, claimed once per request in the delivery ledger.
 */
export class PublicMessageFulfillmentService {
    constructor(
        private readonly owners: ApiKeyOwnerService,
        private readonly bindings: AgentBindingsService,
        private readonly events: EventsService,
        private readonly conversations: PublicConversationsService,
        private readonly holds: PublicMessageHoldsService,
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /**
     * PREPARE of an admitted message, with NO transaction open (concept outbox-job rule 12: the fence's transaction holds the job row and
     * the request row, so nothing it awaits may read through the pool or post outside): the conversation (the route) the message is for,
     * the agent that tells it, and whether it is HELD. A message that asks for an approval, or that was admitted longer ago than its
     * auto-send window (`admittedAt` null: a pre-ledger delivery), is held: no approval road takes a message outside a run, so nothing is
     * sent, and the founder is told once on /chat, with the exact text, as an unhandled case a person answers from the workbench. That post
     * is made HERE, before the fence: it is keyed once per request, so a delivery run again posts nothing twice, and a held request stays
     * held (its reason never goes away), so the commit that follows records the hold it announced.
     */
    async prepare(
        workspaceId: string,
        requestId: string,
        body: MessageRequestBody,
        admittedAt: Date | null,
        keyId: string | null,
    ): Promise<PreparedMessage> {
        const conversation = await this.conversations.find(workspaceId, body.conversationId)
        if (conversation === undefined) throw new PublicApiError({ code: PublicApiErrorCode.ConversationNotFound })
        const agentId = await this.senderOf(workspaceId, keyId, conversation.accountId)
        const isStale = isStaleMessageAdmission(admittedAt, this.clock.now())
        const held = heldReasonOf(body.requireApproval, isStale)
        if (held === null) return { conversation, agentId, held }
        if (isStale)
            this.logger.info(PublicApiLogEvent.StaleMessageHeld, {
                workspaceId,
                requestId,
                admittedAt: admittedAt?.toISOString() ?? null,
            })
        await this.holds.report({ workspaceId, agentId, conversationId: conversation.id, requestId, text: body.text, reason: held })
        return { conversation, agentId, held }
    }

    /**
     * COMMIT of a prepared message inside the caller's domain transaction, on its manager only: the evidence recorded, and the send still
     * to make answered (the delivery ledger's claim keeps a repeat from sending twice); null for a held message (its hold recorded).
     */
    async fulfill(
        workspaceId: string,
        requestId: string,
        body: MessageRequestBody,
        prepared: PreparedMessage,
        manager: EntityManager,
        options: FulfillOptions = {},
    ): Promise<PendingMessageDelivery | null> {
        const { dedupeKey = `api.message:${requestId}`, recordEvidence = true } = options
        const { conversation, agentId } = prepared
        if (prepared.held !== null) {
            await this.events.record(
                {
                    workspaceId,
                    kind: "api.message.held",
                    actor: body.source,
                    summary: "Message held: it waits for an approval no road takes",
                    evidence: body.text,
                },
                manager,
            )
            return null
        }
        if (recordEvidence)
            await this.events.record(
                {
                    workspaceId,
                    kind: "api.message",
                    actor: body.source,
                    summary: "Message accepted through the API",
                    evidence: body.text,
                },
                manager,
            )
        return {
            workspaceId,
            sendKey: dedupeKey,
            routeId: conversation.id,
            contactId: conversation.contactId,
            agentId,
            channel: conversation.channel,
            accountId: conversation.accountId,
            text: body.text,
        }
    }

    /** The agent that tells it: the key's own agent while it exists, else the route's front door, else the key owner's own answer (or refusal). */
    private async senderOf(workspaceId: string, keyId: string | null, accountId: string | null): Promise<string> {
        const scoped = keyId === null ? null : await this.owners.scopedAgentOf(workspaceId, keyId)
        if (scoped !== null) return scoped
        const front = accountId === null ? null : await this.bindings.owningAgentOf(workspaceId, accountId)
        if (front !== null) return front
        if (keyId === null) throw new PublicApiError({ code: PublicApiErrorCode.ConversationNotFound })
        const installed = await this.owners.agentOfKey(workspaceId, keyId)
        if (installed === null) throw new PublicApiError({ code: PublicApiErrorCode.ConversationNotFound })
        return installed
    }
}
