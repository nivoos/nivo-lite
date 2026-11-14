import {
    BANK_FEED_DELIVERY_QUEUE,
    DELIVER_BANK_FEED_JOB,
    type BankFeedDeliveryRecorded,
} from "@modules/queues/bank-feed-delivery"

const message: BankFeedDeliveryRecorded = { provider: "casso", deliveryId: "connection:delivery-1" }

describe("Bank feed receipt reference contract", () => {
    it.each([
        undefined,
        null,
        1,
        "delivery-1",
        {},
        { deliveryId: null },
        { deliveryId: 42 },
        { deliveryId: "" },
        { deliveryId: "   " },
        { deliveryId: "delivery-1" },
        { deliveryId: "delivery-1", provider: "unknown" },
        { deliveryId: "delivery-1", provider: null },
    ])("refuses malformed receipt references: %p", (value) => {
        expect(DELIVER_BANK_FEED_JOB.payload(value)).toBe(false)
    })

    it("accepts a durable receipt identity and preserves the intake queue name", () => {
        expect(DELIVER_BANK_FEED_JOB.payload(message)).toBe(true)
        expect(BANK_FEED_DELIVERY_QUEUE).toBe("bank-feed-delivery")
    })

    it.each(["casso", "payos", "sepay-feed"])("accepts the %s provider", (provider) => {
        expect(DELIVER_BANK_FEED_JOB.payload({ provider, deliveryId: "delivery-1" })).toBe(true)
    })
})
