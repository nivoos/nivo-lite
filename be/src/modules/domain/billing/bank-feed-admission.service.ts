import { Injectable, type OnModuleInit } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AccountDataAdmissionsService, type AdmittedRow } from "@modules/domain/account-data"
import { BANK_TRANSACTION_PROVIDERS, bankDoorOf, bankTransactionTypeOf, type BankFeedProvider } from "@modules/domain/bank-feed-inbox"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import { DELIVER_BANK_FEED_JOB, type BankFeedDeliveryRecorded } from "@modules/queues/bank-feed-delivery"

@Injectable()
/**
 * WHAT A NEW BANK MOVEMENT DOES NEXT (account-data rule 7, owner R95): the bank feeds register one admission per `<provider>.transaction`
 * type at boot, and every receiver of the type calls it in the transaction that kept the row (the webhook doors through
 * `BankFeedReceiptService.keep`, the engine's one poll job after its intake answered the row as new). The admission queues the delivery job
 * for the row in that same transaction, so a kept movement is never without its job and an existing row is never queued again.
 */
export class BankFeedAdmissionService implements OnModuleInit {
    constructor(
        private readonly admissions: AccountDataAdmissionsService,
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
    ) {}

    /** Registers the admission of each bank transaction type. */
    onModuleInit(): void {
        for (const provider of BANK_TRANSACTION_PROVIDERS) {
            this.admissions.register(bankTransactionTypeOf(provider), (tx, row) => this.admit(tx, row, bankDoorOf(provider)))
        }
    }

    /** Queues the delivery job of one new movement under its once-key: the connection-scoped key the job locks the row by. */
    async admit(tx: EntityManager, row: AdmittedRow, provider: BankFeedProvider): Promise<void> {
        const message: BankFeedDeliveryRecorded = { provider, deliveryId: `${row.owner.connectionId}:${row.key}` }
        await this.outbox.write(tx, DELIVER_BANK_FEED_JOB.queue, message, {
            job: DELIVER_BANK_FEED_JOB.name,
            dedupeKey: DELIVER_BANK_FEED_JOB.onceKey(message),
        })
    }
}
