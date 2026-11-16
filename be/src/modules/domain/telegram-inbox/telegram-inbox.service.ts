import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import { DELIVER_TELEGRAM_JOB } from "@modules/queues/telegram-delivery"
import {
    type TelegramDeliveryRecorded,
    type TelegramMessageRead,
    type TelegramRawDelivery,
} from "./telegram-inbox.contracts"
import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import {
    AccountDataAdmissionsService,
    AccountDataIntakeService,
    scopedDeliveryIdOf,
    type AdmittedRow,
    type PendingPhases,
    type PendingRow,
} from "@modules/domain/account-data"
import { ConnectionsService } from "@modules/domain/connections"
import { InboundEventsService } from "@modules/domain/inbound-events"
import { ProviderTriggersService, type CanonicalEvent, type PreparedDelivery } from "@modules/domain/provider-triggers"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import type { ClaimedJob } from "@modules/platform/jobs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { telegramUpdate } from "./telegram.data-types"
import { telegramMessageRowsOf, telegramUpdateRowsOf } from "./telegram.normalise.policy"
import { TelegramFilesService } from "./telegram-files.service"
import { TelegramInboxLogEvent } from "./telegram-inbox.log-events"
import { TELEGRAM_MESSAGE_WEBHOOK, type TelegramMessageData, type TelegramUpdateRow } from "./telegram-message.trigger"

/** The name a person with no name on Telegram is kept under for the owner, as the channel shows it. */
const GUEST = "Telegram"

/** The message of a stored update as the account keeps it beside the update. */
const messageReadOf = (row: TelegramUpdateRow, event: CanonicalEvent<TelegramMessageData>): TelegramMessageRead => {
    const message = row.raw.message
    const id = typeof message === "object" && message !== null && "message_id" in message ? message.message_id : Number.NaN
    return {
        chatId: event.subject?.id ?? "",
        messageId: typeof id === "number" ? id : Number.NaN,
        text: event.data.text,
        sentAt: event.data.at === null ? null : Date.parse(event.data.at),
    }
}

/** A message PREPARE made ready (no transaction was open): what is kept beside the update, and its delivery when the bot is live. */
interface PreparedTelegramMessage {
    readonly read: TelegramMessageRead
    readonly delivery: {
        readonly workspaceId: string
        readonly connectionId: string
        readonly visitor: string
        readonly event: CanonicalEvent<TelegramMessageData>
        readonly prepared: PreparedDelivery
    } | null
}

@Injectable()
/**
 * THE TELEGRAM BOT'S ENTRY (the adapter stage of the one event pipeline, concept triggers rule 13). Writes each Telegram update the chat
 * answers once as a `telegram.update` row of its connection's account (the INBOX: its unique key is the dedupe) and publishes its durable
 * receipt in the same transaction. The deferred consumer runs the provider's pure `translate` on the stored row, VERIFIES the connection,
 * asks Telegram for the address of each picture with the bot (`getFile`) and keeps the bytes in the shop's store, hands the canonical event
 * to the ONE delivery function, keeps the message and the person for the account and completes the update. It meets nobody and wakes
 * nobody itself; `/start` is a message like any other.
 */
export class TelegramInboxService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
        private readonly files: TelegramFilesService,
        private readonly intake: AccountDataIntakeService,
        private readonly admissions: AccountDataAdmissionsService,
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
        private readonly connections: ConnectionsService,
        private readonly inboundEvents: InboundEventsService,
        private readonly triggers: ProviderTriggersService,
    ) {}

    /** A redelivered update is acknowledged without being processed again; an update the chat does not answer, or one for a connection nobody holds, is acknowledged and dropped. */
    acceptTelegramDelivery(rawBody: TelegramRawDelivery, connection: string): Promise<void> {
        return this.entityManager.transaction(async (manager) => {
            if (rawBody === undefined) return
            const rows = telegramUpdateRowsOf(rawBody)
            const [first] = rows
            const value = TELEGRAM_MESSAGE_WEBHOOK.raw.safeParse(first?.value)
            if (!value.success || TELEGRAM_MESSAGE_WEBHOOK.translate(value.data, { connectionId: connection }) === null) return
            const written = await this.intake.write(manager, connection, rows)
            if (written.owner === null) {
                this.logger.warn(TelegramInboxLogEvent.UnknownConnection, { connectionId: connection })
                return
            }
            const update = written.rows.find((row) => row.type === telegramUpdate.name)
            if (update?.isNew !== true) return
            await this.admissions.admit(manager, {
                id: update.id,
                type: update.type,
                key: update.key,
                owner: written.owner,
                value: first?.value ?? {},
            })
        })
    }

    /**
     * The ADMISSION of a new `telegram.update` row (the door's tail, account-data rule 7): queues its consumer in the transaction that wrote
     * the row. The one road after the intake: no other way receives a Telegram update (a bot with a webhook set cannot be polled).
     */
    admitUpdate(manager: EntityManager, row: AdmittedRow): Promise<void> {
        const message: TelegramDeliveryRecorded = { deliveryId: `${row.owner.connectionId}:${row.key}` }
        return this.outbox.write(manager, DELIVER_TELEGRAM_JOB.queue, message, {
            job: DELIVER_TELEGRAM_JOB.name,
            dedupeKey: DELIVER_TELEGRAM_JOB.onceKey(message),
        })
    }

    /**
     * Processes a committed update in two phases (concept outbox-job rule 12). PREPARE, with no transaction open: the stored update read as
     * it stands, its message translated and verified, the address of each picture asked of Telegram, the pictures kept and the person met
     * and matched (`prepareMessage`). COMMIT, one short transaction: the update locked again (null: another delivery completed it
     * meanwhile, nothing more is written), the message delivered, the message and the person kept beside it, the update completed. A throw
     * leaves the update pending for the job runner (retry on its ladder, then one dead letter), and a retry delivers the same event id; the
     * files kept the first time come from the effects ledger (`job` keys them).
     */
    async processRecordedDelivery(message: TelegramDeliveryRecorded, job: ClaimedJob): Promise<void> {
        const scoped = scopedDeliveryIdOf(message.deliveryId)
        if (scoped === null) return
        const row = { type: telegramUpdate.name, connectionId: scoped.connectionId, key: scoped.externalId }
        await this.intake.consumePending(this.entityManager, row, this.phasesOf(job))
    }

    /** The two phases of one update: PREPARE its message, then COMMIT it and keep the message beside the update. */
    private phasesOf(job: ClaimedJob): PendingPhases<PreparedTelegramMessage | null> {
        return {
            prepare: (seen) => this.prepareMessage(seen, job),
            commit: async (manager, pending, prepared) => {
                if (prepared === null) return
                const read = await this.commitMessage(manager, prepared)
                await this.intake.write(manager, pending.owner.connectionId, telegramMessageRowsOf(pending.value.raw, read, this.clock.now()))
            },
        }
    }

    /**
     * PREPARE of the message of a stored update, with no transaction open; null (nothing kept beside it) for an update the chat does not
     * answer. A connection that is not live delivers nothing but keeps the message beside the update. Otherwise Telegram is asked for the
     * address of each picture with the bot (`getFile`, an outside call) and the ONE delivery function prepares the event (the pictures kept,
     * the person met, the agents matched).
     */
    private async prepareMessage(pending: PendingRow, job: ClaimedJob): Promise<PreparedTelegramMessage | null> {
        const connectionId = pending.owner.connectionId
        const row = TELEGRAM_MESSAGE_WEBHOOK.raw.safeParse(pending.value)
        const event = row.success ? TELEGRAM_MESSAGE_WEBHOOK.translate(row.data, { connectionId }) : null
        if (!row.success || event === null) return null
        const read = messageReadOf(row.data, event)
        const connection = await this.connections.intakeOf(connectionId, "telegram", this.entityManager)
        if (connection.kind !== "ok") return { read, delivery: null }
        const workspaceId = connection.value.workspaceId
        const visitor = event.subject?.name ?? GUEST
        const addresses = await this.files.addressesOf(connectionId, event.data.attachments)
        const delivery = await this.triggers.prepare({
            workspaceId,
            declaration: TELEGRAM_MESSAGE_WEBHOOK,
            connectionId,
            agentId: null,
            events: [
                {
                    event,
                    raw: { type: pending.type, id: pending.id },
                    attachments: { keptUnder: job.jobId, key: event.data.messageKey, files: addresses },
                    ...(event.data.at === null ? {} : { occurredAt: event.data.at }),
                },
            ],
        })
        return { read, delivery: { workspaceId, connectionId, visitor, event, prepared: delivery } }
    }

    /**
     * COMMIT of a prepared message, in the job's transaction: the first event turning a seeded (pending) bot connected (as a Zalo OA), the
     * ONE delivery function's commit. A message no registered graph takes stays kept raw and is kept for the owner, as a message with no
     * front door was. Answers what is kept beside the update.
     */
    private async commitMessage(manager: EntityManager, message: PreparedTelegramMessage): Promise<TelegramMessageRead> {
        const { delivery } = message
        if (delivery === null) return message.read
        const { workspaceId, connectionId, visitor, event } = delivery
        await this.connections.markReceived(
            connectionId,
            { amount: 0, content: visitor, at: this.clock.now().toISOString(), text: event.data.text.slice(0, 160) },
            manager,
        )
        const delivered = await this.triggers.deliver(delivery.prepared, manager)
        if (delivered.status === "delivered" && delivered.untaken > 0) {
            await this.inboundEvents.keepUnrouted(manager, {
                workspaceId,
                channel: "telegram",
                sender: visitor,
                body: event.data.text,
                eventId: event.data.messageKey,
            })
        }
        return message.read
    }
}
