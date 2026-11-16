import {
    receiptCasesOf,
    tx1,
    incoming,
    feedDelivery,
} from "@tests/fixtures/builders/bank-feed-receipts.builder"
import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { isTransactionManager } from "@starci/jest-preset/entity-manager"
import { BankFeedReceiptService } from "@modules/domain/bank-feed-inbox"
import { SepayConnectionService } from "@modules/domain/channel-connections"
import { FeedWebhookRegistryService } from "@modules/domain/provider-registry"
import { SepayFeedWebhookService } from "@modules/domain/sepay-provider"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { BankFeedReceiptsService } from "./bank-feed-receipts.service"
import type { BankFeedProvider } from "./billing.contracts"
import { BillingError, BillingErrorCode } from "./errors/billing.error"
import { PaymentProofService } from "./payment-proof.service"

/** What `run` throws, read as `unknown`; the matcher then judges its fields. */
const thrownBy = (run: () => unknown): unknown => {
    try {
        run()
    } catch (error) {
        return error
    }
    return undefined
}

const objectLike = (shape: Record<string, unknown>): unknown => expect.objectContaining(shape)
const raw = (body: object): Buffer => Buffer.from(JSON.stringify(body))
const refusal = new BillingError({ code: BillingErrorCode.WebhookInvalid })
// The shared payOS fixture carries `reference: "REF1"`: the bank's reference now rides on the credit beside the unchanged event id.
const cases = receiptCasesOf(tx1, incoming).map((receiptCase) =>
    receiptCase.provider === "payos"
        ? { ...receiptCase, credits: receiptCase.credits.map((credit) => ({ ...credit, bankRef: "REF1" })) }
        : receiptCase,
)
const build = async () => {
    const tx = fakeTransaction(mockEntityManager())
    const proof = mock<PaymentProofService>()
    const feedInbox = mock<BankFeedReceiptService>()
    feedInbox.keep.mockResolvedValue(1)
    const sepayPage = mock<SepayConnectionService>()
    sepayPage.traceIntake.mockImplementation((_feed, _raw, intake) => intake())
    sepayPage.traceRefusal.mockResolvedValue(undefined)
    const moduleRef = await Test.createTestingModule({
        providers: [
            BankFeedReceiptsService,
            FeedWebhookRegistryService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: PaymentProofService, useValue: proof },
            { provide: BankFeedReceiptService, useValue: feedInbox },
        ],
    }).compile()
    const webhooks = moduleRef.get(FeedWebhookRegistryService)
    webhooks.register(new SepayFeedWebhookService(sepayPage, webhooks))
    return { feed: moduleRef.get(BankFeedReceiptsService), tx, proof, feedInbox, sepayPage }
}
const acceptReceipt = (feed: BankFeedReceiptsService, provider: BankFeedProvider, body: object) => {
    if (provider === "casso") return feed.acceptCassoDelivery(raw(body), "conn-1")
    if (provider === "payos") return feed.acceptPayosDelivery(raw(body), "conn-1")
    return feed.acceptFeedDelivery(raw(body), "conn-1", "sepay")
}
describe("BankFeedReceiptsService provider receipt intake", () => {
    it.each(cases)("keeps the $provider movement in one transaction, as a webhook row, without booking", async ({ provider, body, credits }) => {
        const { feed, feedInbox, tx } = await build()
        await acceptReceipt(feed, provider, body)
        const manager = feedInbox.keep.mock.calls[0]?.[0]
        expect(isTransactionManager(manager)).toBe(true)
        expect(feedInbox.keep).toHaveBeenCalledWith(manager, provider, "conn-1", credits, "webhook")
        expect(tx.commits).toBe(1)
        expect(tx.em.query).not.toHaveBeenCalled()
        expect(tx.em.createQueryBuilder).not.toHaveBeenCalled()
    })
    it.each(cases)("acknowledges duplicate $provider deliveries (the inbox keeps nothing new)", async ({ provider, body }) => {
        const { feed, feedInbox, tx } = await build()
        feedInbox.keep.mockResolvedValue(0)
        await acceptReceipt(feed, provider, body)
        expect(tx.commits).toBe(1)
    })
    it.each(cases)("rolls back a failed $provider keep or admission", async ({ provider, body }) => {
        const { feed, feedInbox, tx } = await build()
        feedInbox.keep.mockRejectedValue(refusal)
        await expect(acceptReceipt(feed, provider, body)).rejects.toBe(refusal)
        expect(tx.rollbacks).toBe(1)
    })
    it("ignores Casso errors, payOS pings/unpaid deliveries and unknown or unusable SePay transfers", async () => {
        const { feed, tx, feedInbox } = await build()
        await feed.acceptCassoDelivery(raw({ error: 3, data: tx1 }), "conn-1")
        await feed.acceptCassoDelivery(raw({ error: 0, data: [{ id: 9, amount: -1 }] }), "conn-1")
        await feed.acceptPayosDelivery(raw({ code: "00", data: { orderCode: 123, amount: 1 } }), "conn-1")
        await feed.acceptPayosDelivery(raw({ code: "01", data: {} }), "conn-1")
        await feed.acceptFeedDelivery(raw({ ...incoming, transferType: "refund" }), "conn-1", "sepay")
        await feed.acceptFeedDelivery(raw({ ...incoming, transferType: "out", transferAmount: 0 }), "conn-1", "sepay")
        await feed.acceptFeedDelivery(raw({ ...incoming, transferAmount: 0 }), "conn-1", "sepay")
        await feed.acceptFeedDelivery(raw({ ...incoming, transferAmount: "lots" }), "conn-1", "sepay")
        expect(feedInbox.keep).not.toHaveBeenCalled()
        expect(tx.outcomes).toEqual([])
    })
    it("acknowledges a SePay test ping without an id and settles nothing", async () => {
        const { feed, tx, feedInbox } = await build()
        await expect(feed.acceptFeedDelivery(raw({}), "conn-1", "sepay")).resolves.toBeUndefined()
        expect(feedInbox.keep).not.toHaveBeenCalled()
        expect(tx.outcomes).toEqual([])
    })
    it("refuses a money delivery without a usable id and a delivery for a provider that registered no webhook", async () => {
        const { feed, feedInbox } = await build()
        await expect(feed.acceptFeedDelivery(raw({ ...incoming, id: 1.5 }), "conn-1", "sepay")).rejects.toEqual(refusal)
        await expect(feed.acceptFeedDelivery(raw(incoming), "conn-1", "unknown")).rejects.toEqual(refusal)
        expect(feedInbox.keep).not.toHaveBeenCalled()
    })
    it("leaves a refused key of a provider with no webhook unremembered", async () => {
        const { feed, proof, sepayPage } = await build()
        proof.proveFeed.mockRejectedValue(new BillingError({ code: BillingErrorCode.WebhookUnauthorized }))
        await expect(
            feed.verifyFeedDelivery("Apikey k", "conn-1", Buffer.from("{}"), "unknown"),
        ).rejects.toBeInstanceOf(BillingError)
        expect(sepayPage.traceRefusal).not.toHaveBeenCalled()
    })
    it("rejects an absent Casso body before intake", async () => {
        const { feed, tx } = await build()
        expect(thrownBy(() => feed.acceptCassoDelivery(undefined, "conn-1"))).toEqual(
            objectLike({ code: BillingErrorCode.WebhookInvalid }),
        )
        expect(tx.outcomes).toEqual([])
    })
    it.each([false, true])("propagates SePay proof failure %s before intake", async (fails) => {
        const { feed, proof, tx } = await build()
        if (fails) proof.proveFeed.mockRejectedValue(refusal)
        const result = feed.verifyFeedDelivery(feedDelivery.authorization, "conn-1", feedDelivery.rawBody, "sepay")
        if (fails) await expect(result).rejects.toBe(refusal)
        else await expect(result).resolves.toBeUndefined()
        expect(proof.proveFeed).toHaveBeenCalledWith("sepay", feedDelivery)
        expect(tx.outcomes).toEqual([])
    })
})
describe("BankFeedReceiptsService SePay connection page", () => {
    it.each([
        [new BillingError({ code: BillingErrorCode.WebhookUnauthorized }), 1],
        [refusal, 0],
    ])("remembers a refused key only, and rethrows %p", async (failure, traced) => {
        const { feed, proof, sepayPage } = await build()
        proof.proveFeed.mockRejectedValue(failure)
        const result = feed.verifyFeedDelivery(feedDelivery.authorization, "conn-1", feedDelivery.rawBody, "sepay")
        await expect(result).rejects.toBe(failure)
        expect(sepayPage.traceRefusal).toHaveBeenCalledTimes(traced)
    })
    it("hands the raw delivery to the page trace around the intake", async () => {
        const { feed, sepayPage } = await build()
        const body = raw({ ...incoming })
        await feed.acceptFeedDelivery(body, "conn-1", "sepay")
        expect(sepayPage.traceIntake).toHaveBeenCalledWith("conn-1", body, expect.any(Function))
    })
})
describe("BankFeedReceiptsService bank facts", () => {
    it("passes the bank's reference, account and time of a Casso row to the claimed credit", async () => {
        const { feed, feedInbox } = await build()
        const row = { ...tx1, tid: "FT20322ABCD", bank_sub_acc_id: "0123456789", when: "2020-11-17 18:46:56" }
        const body = raw({ error: 0, data: [row] })
        await feed.acceptCassoDelivery(body, "conn-1")
        expect(feedInbox.keep).toHaveBeenCalledWith(
            expect.anything(),
            "casso",
            "conn-1",
            [
                {
                    amount: 150000,
                    content: "NIVO8F3K2",
                    eventId: "casso:7",
                    fallbackBankName: "ACB",
                    bankRef: "FT20322ABCD",
                    account: "0123456789",
                    occurredAt: "2020-11-17T11:46:56.000Z",
                },
            ],
            "webhook",
        )
    })
    it("passes the bank's facts of a paid payOS order, keyed as before", async () => {
        const { feed, feedInbox } = await build()
        const data = {
            amount: 10,
            reference: "FT1",
            accountNumber: "12345678",
            transactionDateTime: "2023-02-04 18:25:00",
        }
        await feed.acceptPayosDelivery(raw({ code: "00", data }), "conn-1")
        expect(feedInbox.keep).toHaveBeenCalledWith(
            expect.anything(),
            "payos",
            "conn-1",
            [
                {
                    amount: 10,
                    content: "",
                    eventId: "payos:FT1",
                    fallbackBankName: "payOS",
                    bankRef: "FT1",
                    account: "12345678",
                    occurredAt: "2023-02-04T11:25:00.000Z",
                },
            ],
            "webhook",
        )
    })
    it("passes no bank member for a payOS order known only by its order code", async () => {
        const { feed, feedInbox } = await build()
        await feed.acceptPayosDelivery(raw({ code: "00", data: { orderCode: 7, amount: 10 } }), "conn-1")
        expect(feedInbox.keep).toHaveBeenCalledWith(
            expect.anything(),
            "payos",
            "conn-1",
            [{ amount: 10, content: "", eventId: "payos:7", fallbackBankName: "payOS" }],
            "webhook",
        )
    })
    it("passes the SePay referenceCode of a delivery as the bank's reference", async () => {
        const { feed, feedInbox } = await build()
        await feed.acceptFeedDelivery(raw({ ...incoming, referenceCode: "FT321" }), "conn-1", "sepay")
        expect(feedInbox.keep).toHaveBeenCalledWith(
            expect.anything(),
            "sepay-feed",
            "conn-1",
            [objectLike({ eventId: "sepay:321", bankRef: "FT321" })],
            "webhook",
        )
    })
})
describe("BankFeedReceiptsService debits", () => {
    const outgoing = { ...incoming, id: 654, transferType: "out", transferAmount: 45000.4, content: "Pay supplier" }
    it("keeps a SePay transfer out as a debit movement", async () => {
        const { feed, feedInbox } = await build()
        await feed.acceptFeedDelivery(raw(outgoing), "conn-1", "sepay")
        expect(feedInbox.keep).toHaveBeenCalledWith(
            expect.anything(),
            "sepay-feed",
            "conn-1",
            [
                {
                    amount: 45000.4,
                    content: "Pay supplier",
                    eventId: "sepay:654",
                    fallbackBankName: "MBBank",
                    direction: "debit",
                },
            ],
            "webhook",
        )
    })
})
describe("BankFeedReceiptsService SePay content fallback", () => {
    it.each([
        { description: " from description ", expected: "from description" },
        { code: "CODE1", expected: "CODE1" },
        { expected: "" },
    ])("records the SePay content fallback $expected", async ({ expected, ...fields }) => {
        const { feed, feedInbox } = await build()
        await feed.acceptFeedDelivery(
            raw({ id: 7, transferType: "in", transferAmount: 10, ...fields }),
            "conn-1",
            "sepay",
        )
        expect(feedInbox.keep).toHaveBeenCalledWith(
            expect.anything(),
            "sepay-feed",
            "conn-1",
            [objectLike({ content: expected, eventId: "sepay:7", fallbackBankName: "SePay" })],
            "webhook",
        )
    })
})
