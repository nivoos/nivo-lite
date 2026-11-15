import { BankFeedReceiptService } from "@modules/domain/bank-feed-inbox"
import type { BankFeedDeliveryRecorded } from "@modules/queues/bank-feed-delivery"
import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { callDbFunction, InjectPrimaryEntityManager } from "@modules/platform/database"
import { BankFeedTriggerService } from "./bank-feed-trigger.service"

@Injectable()
/**
 * Consumes one admitted movement of a payment connection (a `<provider>.transaction` row a door or the poll kept, queued by its admission): the
 * connection is marked as working, the movement is handed to the account's provider trigger and the row is completed, all in one
 * transaction. It decides nothing about what a movement means.
 */
export class BankFeedService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
        private readonly bankFeedInbox: BankFeedReceiptService,
        private readonly trigger: BankFeedTriggerService,
    ) {}

    /**
     * Processes one admitted movement; an absent or already completed one (a redelivery of the job) does nothing. PREPARE first, with no
     * transaction open (concept outbox-job rule 12), from the movement as it stands; then ONE short transaction: the movement locked again
     * (absent: another delivery completed it meanwhile), marked, delivered, completed.
     */
    async processRecordedFeedDelivery(message: BankFeedDeliveryRecorded): Promise<void> {
        const seen = await this.bankFeedInbox.seen(this.entityManager, message.provider, message.deliveryId)
        if (seen === undefined) return
        const prepared = await this.trigger.prepare(seen.owner, { type: seen.row.type, id: seen.row.id, value: seen.value })
        await this.entityManager.transaction(async (manager) => {
            const pending = await this.bankFeedInbox.lock(manager, message.provider, message.deliveryId)
            if (pending === undefined) return
            await this.markFed(manager, pending.owner.connectionId, pending.value)
            await this.trigger.emit(manager, prepared)
            await this.bankFeedInbox.complete(manager, pending)
        })
    }

    /** Remembers that the connection works (what the connection wizard waits for), with the movement as the event. */
    private async markFed(tx: EntityManager, connectionId: string, movement: Readonly<Record<string, unknown>>): Promise<void> {
        const at = this.clock.now()
        await callDbFunction(tx, "public.connection_mark_fed", [
            connectionId,
            at,
            JSON.stringify({ amount: Number(movement.amount), content: String(movement.content), at: at.toISOString() }),
        ])
    }
}
