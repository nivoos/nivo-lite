import type { ConnectionRecord } from "@modules/domain/connections"
import {
    providerRefusal,
    type PaymentLinkPort,
    type PaymentLinkRef,
    type PaymentLinkState,
    type PaymentRequest,
    type PaymentRequestAsk,
    type PaymentRequestPort,
    type PaymentRequestState,
    type PaymentRequestStatus,
} from "@modules/domain/provider-registry"

/** The provider key. */
const PROVIDER = "payos"

/**
 * The longest description payOS takes from EVERY account: its create reference states a limit of 9 characters for a bank account not linked
 * through payOS (`PAYOS_OPS.createLink`, https://payos.vn/docs/api/), and NIVO cannot tell a linked account from another. The description is
 * only what the payer's bank shows: the paid event is matched by the request reference (the order code), never by it.
 */
export const PAYOS_DESCRIPTION_MAX = 9

/**
 * The generic page the payer's browser is sent back to after paying or cancelling on payOS's page, below the site origin configured for the
 * environment (`SITE_URL`): payOS requires both addresses (`returnUrl`, `cancelUrl`) and appends its own parameters (`code`, `id`, `cancel`,
 * `status`, `orderCode`, https://payos.vn/docs/du-lieu-tra-ve/return-url), so ONE static page serves both. No package or shop page.
 */
export const PAY_RETURN_PATH = "/pay/done"

/**
 * payOS's status words in the neutral words: PAID, CANCELLED and EXPIRED move; PENDING and PROCESSING (documented,
 * https://payos.vn/docs/du-lieu-tra-ve/return-url) and any word the documentation read does not name are still payable (`open`): the paid
 * event still settles the order, and the next read sees the word again.
 */
const STATUS_OF: Readonly<Record<string, PaymentRequestStatus>> = { PAID: "paid", CANCELLED: "cancelled", EXPIRED: "expired" }

/** The neutral status of a payOS status word. */
export const payosStatusOf = (word: string): PaymentRequestStatus => STATUS_OF[word.toUpperCase()] ?? "open"

/** The description payOS gets: the reference's letters and digits, its LAST nine (the end of an order code is what tells two apart). */
export const payosDescriptionOf = (reference: string): string => {
    const kept = [...reference].filter((char) => /[\p{L}\p{N}]/u.test(char)).join("")
    return (kept === "" ? reference : kept).slice(-PAYOS_DESCRIPTION_MAX)
}

/** The link a request reference names: its order code (the reference NIVO hands out); anything that is no order code is held by nobody. */
const linkRefOf = (requestRef: string): PaymentLinkRef => {
    const orderCode = Number(requestRef)
    if (!/^\d+$/u.test(requestRef) || !Number.isSafeInteger(orderCode)) throw providerRefusal(PROVIDER, "not_found")
    return { orderCode }
}

/** A get or cancel answer in the neutral words. */
const stateOf = (link: PaymentLinkState): PaymentRequestState => ({
    requestRef: String(link.orderCode),
    amountVnd: link.amountVnd,
    ...(link.amountPaidVnd === undefined ? {} : { amountPaidVnd: link.amountPaidVnd }),
    status: payosStatusOf(link.status),
    providerStatus: link.status,
    ...(link.canceledAt === undefined ? {} : { cancelledAt: link.canceledAt }),
})

/**
 * payOS's adapter of the payment-request purpose (owner ruling R111), over its own payment-link port: the live link service or its sandbox
 * twin, so both answer the neutral port the same way. A request IS a hosted link: `requestRef` is its order code as text (the paid webhook
 * carries the same code), `payUrl` its checkout page, `qrPayload` the QR text payOS gave (never a picture address). The return and cancel
 * addresses are the environment's site origin and one generic page.
 */
export class PayosPaymentRequestAdapter implements PaymentRequestPort {
    readonly provider: typeof PROVIDER = PROVIDER

    constructor(
        private readonly links: PaymentLinkPort,
        private readonly siteBase: () => string,
    ) {}

    /** Creates the link; the reference stays NIVO's, payOS gets its short description and its own order code. */
    async create(connection: ConnectionRecord, ask: PaymentRequestAsk): Promise<PaymentRequest> {
        const back = `${this.siteBase()}${PAY_RETURN_PATH}`
        const link = await this.links.create(connection, {
            amountVnd: ask.amountVnd,
            description: payosDescriptionOf(ask.reference),
            returnUrl: back,
            cancelUrl: back,
            ...(ask.expiresAt === undefined ? {} : { expiresAt: ask.expiresAt }),
        })
        return {
            amountVnd: link.amountVnd,
            reference: ask.reference,
            status: payosStatusOf(link.status),
            payUrl: link.checkoutUrl,
            ...(link.qrPayload === undefined ? {} : { qrPayload: link.qrPayload }),
            requestRef: String(link.orderCode),
            payKey: String(link.orderCode),
            ...(link.expiresAt === undefined ? {} : { expiresAt: link.expiresAt }),
        }
    }

    /** Reads the link by its order code. */
    async get(connection: ConnectionRecord, requestRef: string): Promise<PaymentRequestState> {
        return stateOf(await this.links.get(connection, linkRefOf(requestRef)))
    }

    /** Cancels the link by its order code. */
    async cancel(connection: ConnectionRecord, requestRef: string, reason: string | undefined): Promise<PaymentRequestState> {
        return stateOf(await this.links.cancel(connection, linkRefOf(requestRef), reason))
    }
}
