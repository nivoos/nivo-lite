import { bankTransactionTriggerFor } from "@modules/domain/bank-feed-inbox"
import type { ConnectionRecord } from "@modules/domain/connections"
import { providerRefusalReason, type PaymentRequestPort } from "@modules/domain/provider-registry"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { SepayPaymentInstructionService } from "./sepay-payment-instruction.service"
import { SepayPaymentRequestAdapter } from "./sepay-payment-request.adapter"
import { SepaySandboxPaymentInstructionService } from "./sepay-sandbox-payment-instruction.service"

const ASK = { amountVnd: 150000, reference: "DH-20261113-0001" }
const LIVE: ConnectionRecord = connectionRecord({
    id: "conn-s",
    workspaceId: "ws-1",
    provider: "sepay",
    meta: { account_number: "9988776655", bank_code: "VCB", account_holder: "HOA SHOP" },
})
const SANDBOX: ConnectionRecord = connectionRecord({ id: "conn-sbx", workspaceId: "ws-1", provider: "sepay", sandbox: true })

const thrownOf = (run: Promise<unknown>): Promise<unknown> => run.catch((cause: unknown) => cause)

describe("SepayPaymentRequestAdapter (R111)", () => {
    it("is a request port that keeps NO request: create only (the tool answers get / cancel with no_request_state)", () => {
        const adapter: PaymentRequestPort = new SepayPaymentRequestAdapter(new SepayPaymentInstructionService())
        expect(adapter.provider).toBe("sepay")
        expect(adapter.get).toBeUndefined()
        expect(adapter.cancel).toBeUndefined()
    })

    it("answers the bank-transfer instruction in the neutral words: a QR picture, the bank details, the words to write and the same words as the key", async () => {
        const request = await new SepayPaymentRequestAdapter(new SepayPaymentInstructionService()).create(LIVE, ASK)

        expect(request).toMatchObject({
            amountVnd: 150000,
            reference: "DH-20261113-0001",
            status: "open",
            transferContent: "DH-20261113-0001",
            payKey: "DH-20261113-0001",
            bank: { accountNumber: "9988776655", code: "VCB", holder: "HOA SHOP" },
        })
        expect(request.qrImageUrl).toContain("9988776655")
        expect(request).not.toHaveProperty("requestRef")
        expect(request).not.toHaveProperty("payUrl")
    })

    it("on a SePay sandbox account answers through the sandbox twin, same shape, nothing live reached", async () => {
        const { sandbox } = sandboxServiceOf(sandboxAccount({ id: "conn-sbx", workspaceId: "ws-1", provider: "sepay" }))
        const request = await new SepayPaymentRequestAdapter(new SepaySandboxPaymentInstructionService(sandbox)).create(SANDBOX, ASK)

        expect(request).toMatchObject({ reference: "DH-20261113-0001", status: "open", payKey: "DH-20261113-0001", transferContent: "DH-20261113-0001" })
        expect(request).not.toHaveProperty("requestRef")
    })

    it("a SePay credit's payKey is its transfer content, so a credit that holds the order's code matches the request's key", () => {
        const event = bankTransactionTriggerFor("sepay")?.translate({
            transactionId: "sepay:1",
            amount: 150000,
            direction: "credit",
            content: "CK DH-20261113-0001 Lan",
            source: "webhook",
        }, { connectionId: "conn-s" })
        expect(event?.data.payKey).toBe("CK DH-20261113-0001 Lan")
        expect(event?.data.payKey.includes(ASK.reference)).toBe(true)
    })

    it("refuses an account with no receiving details (no_credential: the owner fills the connection)", async () => {
        const bare = connectionRecord({ id: "conn-x", workspaceId: "ws-1", provider: "sepay" })
        expect(providerRefusalReason(await thrownOf(new SepayPaymentRequestAdapter(new SepayPaymentInstructionService()).create(bare, ASK)))).toBe("no_credential")
    })
})
