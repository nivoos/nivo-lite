import type { PendingBankMovement } from "@modules/domain/bank-feed-inbox"

const raw = (body: object): Buffer => Buffer.from(JSON.stringify(body))

/** The clock instant used while consuming committed receipt fixtures. */
export const DEFERRED_AT = "2026-10-12T10:00:00.000Z"
type ReceiptPayloadCreditsShape = {
    amount: number
    content: string
    eventId: string
    fallbackBankName: string
}
const receiptOwner = { provider: "casso", connectionId: "c-1", workspaceId: "ws-1" }
const movement = { transactionId: "bank:7", amount: 125000, direction: "credit", content: "NIVO123", source: "webhook" }

/** A kept bank movement ready for its delivery job: the locked transaction row of the connection's account. */
export const receipt: PendingBankMovement = {
    value: movement,
    owner: receiptOwner,
    row: { id: "receipt-1", type: "casso.transaction", key: "bank:7", owner: receiptOwner, value: movement },
}
/** The provider kinds whose receipts share the deferred booking workflow. */
export const providers = ["casso", "payos", "sepay-feed"] as const

type ReceiptCasesOfResultShape3 = {
    provider: "sepay-feed"
    body: object
    credits: Array<ReceiptPayloadCreditsShape>
}

type ReceiptCasesOfResultBodyDataShape = {
    amount: number
    reference: string
}

type ReceiptCasesOfResultBodyShape = {
    code: string
    data: ReceiptCasesOfResultBodyDataShape
    error?: never
}

type ReceiptCasesOfResultShape2 = {
    provider: "payos"
    body: ReceiptCasesOfResultBodyShape
    credits: Array<ReceiptPayloadCreditsShape>
}

type ReceiptCasesOfResultBodyShapeOf = {
    error: number
    data: object
    code?: never
}

type ReceiptCasesOfResultShape = {
    provider: "casso"
    body: ReceiptCasesOfResultBodyShapeOf
    credits: Array<ReceiptPayloadCreditsShape>
}

/** Builds the three provider receipt identities and expected credits. */
export const receiptCasesOf = (
    tx1: object,
    incoming: object,
): Array<ReceiptCasesOfResultShape | ReceiptCasesOfResultShape2 | ReceiptCasesOfResultShape3> => [
    {
        provider: "casso" as const,
        body: { error: 0, data: tx1 },
        credits: [{ amount: 150000, content: "NIVO8F3K2", eventId: "casso:7", fallbackBankName: "ACB" }],
    },
    {
        provider: "payos" as const,
        body: { code: "00", data: { amount: 10, reference: "REF1" } },
        credits: [{ amount: 10, content: "", eventId: "payos:REF1", fallbackBankName: "payOS" }],
    },
    {
        provider: "sepay-feed" as const,
        body: incoming,
        credits: [{ amount: 99000, content: "NIVO8F3K2 thanh toan", eventId: "sepay:321", fallbackBankName: "MBBank" }],
    },
]

/** The fixed clock instant for bank-feed intake scenarios. */
export const NOW = "2026-10-12T10:00:00.000Z"
/** A Casso transaction carrying a workspace payment reference. */
export const tx1 = { id: 7, amount: 150000, description: " NIVO8F3K2 ", bankName: "ACB" }

/** A SePay incoming transfer with explicit content and bank identity. */
export const incoming = {
    id: 321,
    transferType: "in",
    transferAmount: 99000,
    content: "NIVO8F3K2 thanh toan",
    gateway: "MBBank",
}

type FeedDeliveryShape = {
    connectionId: string
    authorization: string
    rawBody: Buffer<ArrayBufferLike>
}

/** The credential and raw delivery used to prove the SePay feed boundary. */
export const feedDelivery: FeedDeliveryShape = {
    connectionId: "conn-1",
    authorization: "Apikey k",
    rawBody: raw(incoming),
}
