import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import type { ZaloRawDelivery } from "./zalo-inbox.contracts"
import { DELIVER_ZALO_JOB, type ZaloDeliveryRecorded } from "@modules/queues/zalo-delivery"
import { Injectable, type OnModuleInit } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import {
    AccountDataAdmissionsService,
    AccountDataIntakeService,
    AccountDataReadService,
    scopedDeliveryIdOf,
    type AccountDataInput,
    type AdmittedRow,
    type PendingRow,
} from "@modules/domain/account-data"
import { ZaloCredentialsService } from "@modules/domain/channels"
import { ConnectionsService } from "@modules/domain/connections"
import { InboundEventsService } from "@modules/domain/inbound-events"
import { ProviderTriggersService, type CanonicalEvent, type PreparedDelivery } from "@modules/domain/provider-triggers"
import { ZALO_MESSAGE_TRIGGER, ZaloStaleJudgeService, zaloAppIdOf, type ZaloMessageData } from "@modules/domain/zalo-provider"
import { zaloEventNameOf } from "@modules/integrations/zalo"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import type { ClaimedJob } from "@modules/platform/jobs"
import type { WebhookProofVerdict } from "@modules/platform/http-security"
import { InjectMessageCatalog, type MessageCatalog } from "@modules/platform/i18n"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder, isRecord } from "@modules/platform/primitives"
import { zaloEvent, zaloUser } from "./zalo.data-types"
import { mergedZaloUserOf, zaloBodyOf, zaloDerivedRowsOf, zaloEventRowsOf } from "./zalo.normalise.policy"
import { ZaloInboxLogEvent } from "./zalo-inbox.log-events"
import { polledMessageOf } from "./zalo-polled-message.policy"

/** The row just written as new, or undefined when nothing was written (a redelivery, a connection nobody holds). */
type OptionalNewRow = AdmittedRow | undefined

/** A customer message PREPARE made ready (no transaction was open): what its commit writes in the job's transaction. */
interface PreparedZaloMessage {
    readonly workspaceId: string
    readonly connectionId: string
    /** The name the person is kept under for the owner. */
    readonly visitor: string
    readonly event: CanonicalEvent<ZaloMessageData>
    /** The ONE delivery function's prepared delivery of it. */
    readonly delivery: PreparedDelivery
}

/** The language of the guest label a person with no name is kept under for the owner: the shop's owners read it in Vietnamese. */
const LOCALE = "vi"

/** Queues the consumer that processes a committed event. */
const queueConsumer = (outbox: QueueOutbox, manager: EntityManager, deliveryId: string): Promise<void> => {
    const message: ZaloDeliveryRecorded = { deliveryId }
    return outbox.write(manager, DELIVER_ZALO_JOB.queue, message, { job: DELIVER_ZALO_JOB.name, dedupeKey: DELIVER_ZALO_JOB.onceKey(message) })
}

@Injectable()
/**
 * THE ZALO OA'S ENTRY (the adapter stage of the one event pipeline, concept triggers rule 13). Writes each Zalo event once as a
 * `zalo_oa.event` row of its connection's account (the INBOX: its unique key is the dedupe; the webhook and the poll bring the same key for
 * one customer message, so whichever comes first is the one row) and publishes its durable receipt in the same transaction. The deferred
 * consumer VERIFIES the event (a live Zalo connection, the OA's own app), runs the provider's pure `translate` on the stored row, keeps the
 * customer's pictures (their Zalo address expires) and hands the canonical event to the ONE delivery function; it keeps the message and the
 * person for the account and completes the row. It meets nobody and wakes nobody itself.
 */
export class ZaloInboxService implements OnModuleInit {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        private readonly inboundEvents: InboundEventsService,
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
        private readonly intake: AccountDataIntakeService,
        private readonly reads: AccountDataReadService,
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
        private readonly connections: ConnectionsService,
        private readonly credentials: ZaloCredentialsService,
        private readonly triggers: ProviderTriggersService,
        @InjectMessageCatalog() private readonly catalog: MessageCatalog,
        private readonly admissions: AccountDataAdmissionsService,
        private readonly stale: ZaloStaleJudgeService,
    ) {}

    /** Registers the ONE admission of a new `zalo_oa.event` row: the webhook door and the engine's poll job both reach it (account-data rule 7). */
    onModuleInit(): void {
        this.admissions.register(zaloEvent.name, (manager, row) => this.admit(manager, row))
    }

    /**
     * A redelivered event is acknowledged without being processed again. The door's verdict is obeyed, never decided again here: an
     * `unproven` delivery (a live connection that holds no OA secret key yet) is written and completed at once, never admitted (it is no
     * message an agent may answer: nothing proves it came from Zalo); a `proven` one (the OA's mac, or a sandbox account's key) goes to the
     * type's admission.
     */
    acceptZaloDelivery(rawBody: ZaloRawDelivery, connection: string, proof: WebhookProofVerdict): Promise<void> {
        return this.entityManager.transaction(async (manager) => {
            if (rawBody === undefined) return
            const row = await this.receive(manager, connection, rawBody)
            if (row === undefined) return
            if (proof === "unproven") {
                await this.completeNow(manager, connection, row.key)
                return
            }
            await this.admissions.admit(manager, row)
        })
    }

    /**
     * THE ADMISSION of a new `zalo_oa.event` row (the door's tail, one for every way the row came): a fresh message follows the road to its
     * answer (its consumer job is queued); a message the POLL read back that is too old to answer (Zalo's reply window or the stale age,
     * judged now, at the moment the row is new) is completed at once, kept for the owner and for the account, and no agent answers it.
     */
    private async admit(manager: EntityManager, row: AdmittedRow): Promise<void> {
        const connection = row.owner.connectionId
        const polled = polledMessageOf(row.value)
        if (polled === null || !this.stale.isStale(polled.sentAt, this.clock.now().getTime())) {
            await queueConsumer(this.outbox, manager, `${connection}:${row.key}`)
            return
        }
        await this.completeNow(manager, connection, row.key)
        await this.inboundEvents.keepForOwner(manager, {
            workspaceId: row.owner.workspaceId,
            channel: "zalo",
            sender: polled.sender,
            body: polled.text,
            eventId: `zalo:${connection}:${polled.messageId}`,
        })
        await this.keepDerived(manager, connection, polled.raw, polled.sender)
    }

    /**
     * Processes a committed event in two phases (concept outbox-job rule 12). PREPARE, with no transaction open: the stored row read as it
     * stands, its customer message verified and translated, its pictures kept and its person met and matched (`prepareMessage`). COMMIT, one
     * short transaction: the row locked again (null: another delivery completed it meanwhile, nothing more is written), the message
     * delivered, the message and the person kept, the event completed. A throw leaves the event pending and goes back to the job runner,
     * which retries it on its ladder and then dead-letters it with one item; a retry delivers the same event id (one wake) and the files
     * kept the first time come from the effects ledger (`job` keys them).
     */
    async processRecordedDelivery(message: ZaloDeliveryRecorded, job: ClaimedJob): Promise<void> {
        const scoped = scopedDeliveryIdOf(message.deliveryId)
        if (scoped === null) return
        await this.intake.consumePending(
            this.entityManager,
            { type: zaloEvent.name, connectionId: scoped.connectionId, key: scoped.externalId },
            {
                prepare: (seen) => this.prepareMessage(seen, job),
                commit: async (manager, pending, prepared) => {
                    if (prepared !== null) await this.commitMessage(manager, prepared)
                    await this.keepDerived(manager, scoped.connectionId, pending.value.raw, "")
                },
            },
        )
    }

    /** Writes the event row of a delivery; the row when it is new, undefined for a redelivery or a connection nobody holds. */
    private async receive(
        manager: EntityManager,
        connection: string,
        rawBody: Buffer,
    ): Promise<OptionalNewRow> {
        const inputs = zaloEventRowsOf(rawBody)
        const written = await this.intake.write(manager, connection, inputs)
        if (written.owner === null) {
            this.logger.warn(ZaloInboxLogEvent.UnknownConnection, { connectionId: connection })
            return undefined
        }
        const index = written.rows.findIndex((entry) => entry.type === zaloEvent.name)
        const row = written.rows[index]
        const input = inputs[index]
        if (row?.isNew !== true || input === undefined) return undefined
        return { id: row.id, type: row.type, key: row.key, owner: written.owner, value: input.value }
    }

    /** Completes a just-written event that nothing is owed on in the same transaction. */
    private async completeNow(manager: EntityManager, connection: string, key: string): Promise<void> {
        const pending = await this.intake.lockPending(manager, zaloEvent.name, connection, key)
        if (pending !== null) await this.intake.complete(manager, pending)
    }

    /** Keeps the message and the person an event names, the person over what the account already kept of them. */
    private async keepDerived(manager: EntityManager, connectionId: string, raw: unknown, name: string): Promise<void> {
        const rows: Array<AccountDataInput> = []
        await eachInOrder(zaloDerivedRowsOf(raw, this.clock.now(), name), async (row) => {
            rows.push(await this.overStoredUser(manager, connectionId, row))
        })
        if (rows.length > 0) await this.intake.write(manager, connectionId, rows)
    }

    /** A person's row over the one the account keeps of them; any other row as it is. */
    private async overStoredUser(
        manager: EntityManager,
        connectionId: string,
        row: AccountDataInput,
    ): Promise<AccountDataInput> {
        const value: unknown = row.value
        if (row.type !== zaloUser.name || !isRecord(value) || typeof value.userId !== "string") return row
        const stored = await this.reads.get(connectionId, zaloUser.name, value.userId, manager)
        return { type: row.type, value: mergedZaloUserOf(stored?.value ?? null, value) }
    }

    /**
     * PREPARE of the customer message of a stored event, with no transaction open: the provider's pure translate of the row (an event the
     * chat does not answer is logged and closed: null), the connection proven live and of the OA's own app (null otherwise), then the ONE
     * delivery function's own PREPARE (the pictures kept in the shop's store under the line's key, the person met, the agents matched).
     */
    private async prepareMessage(pending: PendingRow, job: ClaimedJob): Promise<PreparedZaloMessage | null> {
        const connectionId = pending.owner.connectionId
        const row = ZALO_MESSAGE_TRIGGER.raw.safeParse(pending.value)
        const event = row.success ? ZALO_MESSAGE_TRIGGER.translate(row.data, { connectionId }) : null
        if (!row.success || event === null) {
            this.logger.info(ZaloInboxLogEvent.EventIgnored, {
                connectionId,
                eventName: zaloEventNameOf(zaloBodyOf(pending.value.raw)) ?? "unreadable",
                reason: "not_answered",
            })
            return null
        }
        const connection = await this.connections.intakeOf(connectionId, "zalo_oa", this.entityManager)
        if (connection.kind !== "ok" || (await this.isOtherApp(connectionId, zaloAppIdOf(row.data.raw)))) return null
        const workspaceId = connection.value.workspaceId
        const visitor = event.subject?.name ?? this.catalog.get("conversations.zaloGuest", {}, LOCALE)
        const delivery = await this.triggers.prepare({
            workspaceId,
            declaration: ZALO_MESSAGE_TRIGGER,
            connectionId,
            agentId: null,
            events: [
                {
                    event,
                    raw: { type: pending.type, id: pending.id },
                    attachments: { keptUnder: job.jobId, key: event.data.messageKey, files: event.data.attachments },
                    ...(event.data.at === null ? {} : { occurredAt: event.data.at }),
                },
            ],
        })
        return { workspaceId, connectionId, visitor, event, delivery }
    }

    /**
     * COMMIT of a prepared customer message, in the job's transaction: the first event turning a pending connection connected, the ONE
     * delivery function's commit. A message no registered graph takes stays kept raw and is kept for the owner, as a message with no front
     * door was.
     */
    private async commitMessage(manager: EntityManager, message: PreparedZaloMessage): Promise<void> {
        const { workspaceId, connectionId, visitor, event } = message
        await this.connections.markReceived(
            connectionId,
            { amount: 0, content: visitor, at: this.clock.now().toISOString(), text: event.data.text.slice(0, 160) },
            manager,
        )
        const delivered = await this.triggers.deliver(message.delivery, manager)
        if (delivered.status === "delivered" && delivered.untaken > 0) await this.keepUntaken(manager, workspaceId, connectionId, visitor, event)
    }

    /** Keeps a message no registered graph took for the owner, as an unrouted channel message. */
    private keepUntaken(
        manager: EntityManager,
        workspaceId: string,
        connectionId: string,
        visitor: string,
        event: CanonicalEvent<ZaloMessageData>,
    ): Promise<void> {
        return this.inboundEvents.keepUnrouted(manager, {
            workspaceId,
            channel: "zalo",
            sender: visitor,
            body: event.data.text,
            eventId: `zalo:${connectionId}:${event.id}`,
        })
    }

    /** True when the event names a Zalo app other than the one the connection holds (an event for another OA app). */
    private async isOtherApp(connectionId: string, appId: string): Promise<boolean> {
        if (appId === "") return false
        const loaded = await this.credentials.load(connectionId)
        return loaded.kind === "ok" && loaded.value.secret.appId !== appId
    }
}
