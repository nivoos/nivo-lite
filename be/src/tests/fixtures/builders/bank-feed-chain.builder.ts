import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { BankFeedReceiptService } from "@modules/domain/bank-feed-inbox"
import { BankFeedDeliveryService } from "@modules/domain/billing/bank-feed-delivery.service"
import { BankFeedService } from "@modules/domain/billing/bank-feed.service"
import { BankFeedTriggerService } from "@modules/domain/billing/bank-feed-trigger.service"
import { ConnectionBindingsReadService } from "@modules/domain/connections"
import { ProviderTriggersService } from "@modules/domain/provider-triggers"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { FencedProcessor, JOB_CLAIMS, type ClaimedJob, type JobClaims, type JobDefinition } from "@modules/platform/jobs"
import { DELIVER_BANK_FEED_JOB, type BankFeedDeliveryRecorded } from "@modules/queues/bank-feed-delivery"
import { receipt } from "./bank-feed-receipts.builder"

/** The delivery every spec of the bank-feed chain runs. */
export const FEED_DELIVERY: BankFeedDeliveryRecorded = { provider: "casso", deliveryId: "c-1:7" }

const MARK_CONNECTION_FED = 'SELECT * FROM "public"."connection_mark_fed"($1, $2, $3)'

/** The processor of the delivery job as the feature composes it: one domain method, the runner judges every failure. */
export class FeedProcessor extends FencedProcessor {
    override readonly queue = "bank-feed-delivery"
    override readonly definition: JobDefinition<BankFeedDeliveryRecorded> = DELIVER_BANK_FEED_JOB
    constructor(private readonly delivery: BankFeedDeliveryService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.delivery.process(job)
    }
}

/**
 * The real consumer chain (delivery service, feed service, trigger) over mocked ports. The "database" is two facts the doubles keep: the
 * admitted movement is pending until `complete` commits, and the wakes the trigger wrote.
 */
export const bankFeedChain = async (claims: JobClaims) => {
    const state = { completed: false, wakes: 0 }
    const tx = fakeTransaction(mockEntityManager({ query: [MARK_CONNECTION_FED, []] }))
    const feedInbox = mock<BankFeedReceiptService>()
    feedInbox.lock.mockImplementation(() => Promise.resolve(state.completed ? undefined : receipt))
    feedInbox.complete.mockImplementation(() => {
        state.completed = true
        return Promise.resolve()
    })
    const connections = mock<ConnectionBindingsReadService>()
    connections.stateOf.mockResolvedValue({ name: "Bank", environment: "live" })
    const triggers = mock<ProviderTriggersService>()
    triggers.deliver.mockImplementation(() => {
        state.wakes += 1
        return Promise.resolve({ status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 0, held: 0 })
    })
    const moduleRef = await Test.createTestingModule({
        providers: [
            BankFeedDeliveryService,
            BankFeedService,
            BankFeedTriggerService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: CLOCK, useValue: new FakeClock("2026-11-12T08:00:00.000Z") },
            { provide: JOB_CLAIMS, useValue: claims },
            { provide: BankFeedReceiptService, useValue: feedInbox },
            { provide: ConnectionBindingsReadService, useValue: connections },
            { provide: ProviderTriggersService, useValue: triggers },
        ],
    }).compile()
    return { processor: new FeedProcessor(moduleRef.get(BankFeedDeliveryService)), state, tx, feedInbox, triggers }
}
