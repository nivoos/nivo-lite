import type { ConnectionRecord } from "@modules/domain/connections"

/**
 * THE PAYMENT-REQUEST PURPOSE (owner ruling R111): "ask a payer to pay an amount for a reference" is ONE capability, served by every money
 * provider through this one port (`nivo.tool.payment.request.create | get | cancel`). WHICH provider issues the request is the account the
 * tool runner's pick order chose; nothing above the port knows the provider. The answer is neutral: what the payer needs (a pay link, a QR
 * picture or payload, the bank details and the words to write) as the provider gave it, and the provider's own reference of the request
 * when it keeps one. A provider that keeps NO request (a bank-transfer instruction composed locally) implements `create` only; the tool then
 * answers `get` / `cancel` with the typed refusal `no_request_state` (final). Failures follow the registry's rule: a refusal the provider
 * answered is `providerRefusal` (no effect); a call that never left proves `not_sent`; one that may have acted proves `unknown` (`withProof`).
 */

/** The neutral status words of a request: still payable, paid in full, withdrawn, past its validity. */
export const PAYMENT_REQUEST_STATUSES = ["open", "paid", "cancelled", "expired"] as const

/** One neutral status word. */
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number]

/** What a payment request is asked for. */
export interface PaymentRequestAsk {
    /** The amount to pay, in VND (a positive integer). */
    readonly amountVnd: number
    /**
     * The caller's own reference (an order code). A provider that recognises a payment by the words of the transfer (a bank-transfer
     * instruction) asks the payer to write it; a provider that keeps its own order code may show it, within its own limits, and never
     * matches by it.
     */
    readonly reference: string
    /** When the request stops being payable, ISO 8601 with an offset, or absent for the provider's own default. */
    readonly expiresAt?: string | undefined
}

/** The bank account a payer transfers into, when the provider names it. */
export interface PaymentRequestBank {
    /** The short bank code, when given. */
    readonly code?: string | undefined
    /** The bank's name, when given. */
    readonly name?: string | undefined
    /** The receiving account number. */
    readonly accountNumber: string
    /** The receiving account's holder, when given. */
    readonly holder?: string | undefined
}

/** A payment request as the provider answered a create: only the members the provider gave. */
export interface PaymentRequest {
    /** The amount, in VND. */
    readonly amountVnd: number
    /** The caller's reference, untouched. */
    readonly reference: string
    /** The neutral status of the request now. */
    readonly status: PaymentRequestStatus
    /** An https address of a page where the payer pays, when the provider gives one. */
    readonly payUrl?: string | undefined
    /** An https address of a QR PICTURE to show the payer, when the provider gives one. */
    readonly qrImageUrl?: string | undefined
    /** The raw QR payload (the text a QR encoder draws), when the provider gives one: never an image address. */
    readonly qrPayload?: string | undefined
    /** The words the payer writes on the transfer, when the provider recognises the payment by them. */
    readonly transferContent?: string | undefined
    /** The bank account the payer transfers into, when the provider names it. */
    readonly bank?: PaymentRequestBank | undefined
    /**
     * The provider's own reference of the request (its order code as text), when it keeps a request: `get` and `cancel` name the request by
     * it, and the provider's paid event of the request carries the same value as `requestRef`. Absent for a provider that keeps none.
     */
    readonly requestRef?: string | undefined
    /**
     * What the provider's paid event of this request carries as its `payKey` (the bank feeds' transaction trigger), declared by the provider
     * for both sides: its request reference when it keeps a request (payOS), else the transfer content the payer writes (a bank-transfer
     * instruction: the payer's words are the only key a bank movement carries). A wait matches the event's `payKey` holding this one.
     */
    readonly payKey: string
    /** When the request stops being payable, ISO 8601, when the provider says. */
    readonly expiresAt?: string | undefined
}

/** A payment request as the provider answers a get or a cancel. */
export interface PaymentRequestState {
    /** The provider's own reference of the request. */
    readonly requestRef: string
    /** The amount, in VND. */
    readonly amountVnd: number
    /** The amount paid so far, in VND, when the provider says. */
    readonly amountPaidVnd?: number | undefined
    /** The neutral status. */
    readonly status: PaymentRequestStatus
    /** The provider's own status word, as it printed it. */
    readonly providerStatus: string
    /** When the request was cancelled, as the provider printed it, when it says. */
    readonly cancelledAt?: string | undefined
}

/**
 * A money provider's payment-request port. `get` and `cancel` are present exactly when the provider keeps request state: their absence IS
 * the declaration that the tool answers `no_request_state` for this provider.
 */
export interface PaymentRequestPort {
    /** The provider key of the accounts it serves. */
    readonly provider: string
    /**
     * Asks the payer to pay on the connection. A provider that creates something answers its own reference; a repeat of the same ask (the
     * engine re-making a create whose answer was lost) may create a second request at the provider: only the request whose answer came back
     * is ever shown to a payer.
     */
    create(connection: ConnectionRecord, ask: PaymentRequestAsk): Promise<PaymentRequest>
    /** Reads one request by its reference; `providerRefusal` `not_found` for one the provider does not hold. */
    get?(connection: ConnectionRecord, requestRef: string): Promise<PaymentRequestState>
    /** Cancels one request by its reference; a request the provider cannot cancel is `rejected`. */
    cancel?(connection: ConnectionRecord, requestRef: string, reason: string | undefined): Promise<PaymentRequestState>
}
