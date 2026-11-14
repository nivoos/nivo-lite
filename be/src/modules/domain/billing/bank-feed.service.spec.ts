import { receipt } from "@tests/fixtures/builders/bank-feed-receipts.builder"
import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { BankFeedReceiptService } from "@modules/domain/bank-feed-inbox"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { BankFeedTriggerService } from "./bank-feed-trigger.service"
import { BankFeedService } from "./bank-feed.service"
import { BillingError, BillingErrorCode } from "./errors/billing.error"

const MARK_CONNECTION_FED = 'SELECT * FROM "public"."connection_mark_fed"($1, $2, $3)'
const NOW = "2026-11-12T08:00:00.000Z"
const refusal = new BillingError({ code: BillingErrorCode.WebhookInvalid })

/**
 * The consumer with the only collaborators it has: the movement inbox and the trigger. No intake, inbound event store, event bus, payment
 * record or agent tag is provided, so a booking, an announcement or a business record could not even be wired.
 */
const build = async () => {
    const tx = fakeTransaction(mockEntityManager({ query: [MARK_CONNECTION_FED, []] }))
    const feedInbox = mock<BankFeedReceiptService>()
    feedInbox.lock.mockResolvedValue(receipt)
    const trigger = mock<BankFeedTriggerService>()
    trigger.emit.mockResolvedValue(undefined)
    const moduleRef = await Test.createTestingModule({
        providers: [
            BankFeedService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: CLOCK, useValue: new FakeClock(NOW) },
            { provide: BankFeedReceiptService, useValue: feedInbox },
            { provide: BankFeedTriggerService, useValue: trigger },
        ],
    }).compile()
    return { feed: moduleRef.get(BankFeedService), tx, feedInbox, trigger }
}

describe("BankFeedService.processRecordedFeedDelivery", () => {
    it.each(["sepay-feed", "casso", "payos"] as const)(
        "marks the account fed, hands the admitted %s movement to the trigger and completes it in one transaction",
        async (provider) => {
            const { feed, feedInbox, trigger, tx } = await build()

            await expect(feed.processRecordedFeedDelivery({ provider, deliveryId: "c-1:bank:7" })).resolves.toBeUndefined()

            const manager = feedInbox.lock.mock.calls[0]?.[0]
            expect(feedInbox.lock).toHaveBeenCalledWith(manager, provider, "c-1:bank:7")
            expect(trigger.emit).toHaveBeenCalledWith(manager, receipt.owner, {
                type: "casso.transaction",
                id: "receipt-1",
                value: receipt.value,
            })
            expect(feedInbox.complete).toHaveBeenCalledWith(manager, receipt)
            expect(tx.commits).toBe(1)
        },
    )

    it("marks the connection as working with the movement as its event, and runs no other query: nothing is booked or recorded", async () => {
        const { feed, tx } = await build()

        await feed.processRecordedFeedDelivery({ provider: "casso", deliveryId: "c-1:bank:7" })

        expect(tx.em.query).toHaveBeenCalledTimes(1)
        expect(tx.em.query).toHaveBeenCalledWith(MARK_CONNECTION_FED, [
            "c-1",
            new Date(NOW),
            JSON.stringify({ amount: 125000, content: "NIVO123", at: NOW }),
        ])
    })

    it("does nothing for a redelivery: an absent or already completed movement marks, emits and completes nothing", async () => {
        const { feed, feedInbox, trigger, tx } = await build()
        feedInbox.lock.mockResolvedValue(undefined)

        await expect(feed.processRecordedFeedDelivery({ provider: "payos", deliveryId: "c-1:bank:7" })).resolves.toBeUndefined()

        expect(tx.em.query).not.toHaveBeenCalled()
        expect(trigger.emit).not.toHaveBeenCalled()
        expect(feedInbox.complete).not.toHaveBeenCalled()
    })

    it("leaves the movement pending when its wake cannot be written", async () => {
        const { feed, feedInbox, trigger, tx } = await build()
        trigger.emit.mockRejectedValue(refusal)

        await expect(feed.processRecordedFeedDelivery({ provider: "casso", deliveryId: "c-1:bank:7" })).rejects.toBe(refusal)

        expect(feedInbox.complete).not.toHaveBeenCalled()
        expect(tx.rollbacks).toBe(1)
    })
})
