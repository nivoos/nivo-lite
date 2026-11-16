import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { PaymentLinkState } from "@modules/domain/provider-registry"
import type { SandboxCatalogue, SandboxInboundCase, SandboxInput, SandboxPayLinkRead, SandboxPayLinks, SandboxStateReader } from "@modules/domain/provider-sandbox"

/** The provider key the payOS sandbox answers for. */
export const PAYOS_SANDBOX_PROVIDER: typeof PROVIDER.payos = PROVIDER.payos

/** The operations (port methods) the cases answer. */
export const PAYOS_SANDBOX_OPERATION = { create: "create", get: "get", cancel: "cancel" } as const

/** The ids of the outbound cases the implementation answers (it reads `state.nextCase` against them; PAYOS-1, PAYOS-4 and PAYOS-5 are the defaults). */
export const PAYOS_SANDBOX_CASE = {
    /** PAYOS-1 (default of `create`): a PENDING link is created. */
    created: "PAYOS-1",
    /** PAYOS-2: payOS refuses the create (order already exists). */
    createRefused: "PAYOS-2",
    /** PAYOS-4 (default of `get`): the account's kept link is read. */
    read: "PAYOS-4",
    /** PAYOS-5 (default of `cancel`): a PENDING link is cancelled. */
    cancelled: "PAYOS-5",
    /** PAYOS-6: payOS answers that the link is not found, whatever the reference. */
    readNotFound: "PAYOS-6",
    /** PAYOS-7: payOS refuses to cancel (the link is not pending), whatever its state. */
    cancelRefused: "PAYOS-7",
    /** PAYOS-11: payOS answers 429 to the create: nothing was sent (proof `not_sent`), the engine retries later. */
    createTransient: "PAYOS-11",
    /** PAYOS-12: the create never gets an answer: the link may exist (proof `unknown`). */
    createTimeout: "PAYOS-12",
    /** PAYOS-13: 429 to the read. */
    readTransient: "PAYOS-13",
    /** PAYOS-14: the read never gets an answer (proof `unknown`). */
    readTimeout: "PAYOS-14",
    /** PAYOS-15: 429 to the cancel. */
    cancelTransient: "PAYOS-15",
    /** PAYOS-16: the cancel never gets an answer (proof `unknown`: the link may be cancelled). */
    cancelTimeout: "PAYOS-16",
    /** PAYOS-19: the create gets no answer, but the link WAS created (proof `unknown`; a read finds it). */
    createTimeoutApplied: "PAYOS-19",
    /** PAYOS-20: the cancel gets no answer, but the link WAS cancelled (proof `unknown`; a read finds it CANCELLED). */
    cancelTimeoutApplied: "PAYOS-20",
} as const

/** The order code PAYOS-8 names when none is given: a code no sandbox account ever issues. */
export const PAYOS_SANDBOX_UNKNOWN_ORDER_CODE = 1_789_999_999_999

/** The words payOS refuses with for a duplicate order code (its documentation names the refusal "order already exists"). */
export const PAYOS_SANDBOX_REFUSED_REASON = "order already exists"

/** Why the sandbox cancels a link that is no longer pending: the refusal's words. */
export const PAYOS_SANDBOX_CANNOT_CANCEL_REASON = "link is not pending"

/** The order code of the first link a sandbox account creates (the next ones count up from it): the paid webhook below names it. */
export const PAYOS_SANDBOX_FIRST_ORDER_CODE = 1_780_000_000_001

/**
 * The id of the n-th link of an account (n counts from 1). It names its account (`sbx-payos-<connection id>-000001`), so a link id is
 * unique across accounts and the pay page resolves an id alone to its account. The checkout address of a link is the sandbox frame's
 * (`ProviderSandboxService.payPageUrl`): NIVO's own pretend payment page, never payOS's.
 */
export const payosSandboxLinkId = (connectionId: string, n: number): string => `sbx-payos-${connectionId}-${String(n).padStart(6, "0")}`

/** The account a link id of this sandbox names, or null for an id the sandbox does not issue. */
export const payosSandboxLinkAccountOf = (linkId: string): string | null => /^sbx-payos-(.+)-\d{6,}$/u.exec(linkId)?.[1] ?? null

/** The raw QR payload every sandbox link carries (fixed). */
export const PAYOS_SANDBOX_QR_PAYLOAD = "00020101021238570010A000000727sandbox"

/** The fixed instant every sandbox link is created and cancelled at (the sandbox never reads the clock). */
export const PAYOS_SANDBOX_AT = "2026-11-14T10:00:00+07:00"

/** The state name the links an account created are kept under, by link id (the payment-link sandbox writes it, the paid case reads it). */
const LINK_STATE = "link"

/** The words of payOS's status of a link that is still to be paid. */
const PENDING = "PENDING"

/** The state name the link id of an order code is kept under, by the code's text. */
const ORDER_STATE = "order"

/** The state name the description (the transfer content) a link was created with is kept under, by link id: what the paid webhook then carries. */
export const PAYOS_SANDBOX_DESCRIPTION_STATE = "description"

/** The state name the instant a link stops being valid (ISO 8601) is kept under, by link id, when the request asked for one. */
export const PAYOS_SANDBOX_EXPIRY_STATE = "expiry"

/** The transfer content the paid webhook names when the account holds no link of the order code. */
const PAYOS_SANDBOX_DEFAULT_DESCRIPTION = "DH001"

/** payOS's booking time text (Vietnam time, UTC+7, no zone) of an instant. */
export const payosTimeOf = (at: Date): string => new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ")

/** The amount the paid webhook names when the account holds no link of the order code. */
const PAYOS_SANDBOX_DEFAULT_AMOUNT = 150000

/** A kept link read as its state, or null when the value is none. */
const linkOf = (kept: unknown): PaymentLinkState | null =>
    typeof kept === "object" && kept !== null && typeof Reflect.get(kept, "linkId") === "string" ? (kept as PaymentLinkState) : null

/** Whether a link that is still PENDING has run past the instant it was asked to stop at. */
const lapsed = (expiry: unknown, now: Date): boolean => typeof expiry === "string" && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) <= now.getTime()

/**
 * The body payOS posts to NIVO when a sandbox link is paid: its real shape (`code`, `desc`, `success`, `data` with the paid order,
 * `signature`). The signature is a fixed placeholder: the sandbox route is proven by the account's sandbox key, never by a checksum key
 * (the sandbox holds none).
 */
const paidBodyOf = (paid: {
    readonly orderCode: number
    readonly linkId: string
    readonly amount: number
    readonly description: string
    readonly seq: number
    readonly at: Date
}) =>
    ({
        code: "00",
        desc: "success",
        success: true,
        data: {
            orderCode: paid.orderCode,
            amount: paid.amount,
            description: paid.description,
            accountNumber: "12345678",
            reference: `SBXPAYOS${String(paid.seq + 1).padStart(6, "0")}`,
            transactionDateTime: payosTimeOf(paid.at),
            currency: "VND",
            paymentLinkId: paid.linkId,
            code: "00",
            desc: "Thành công",
            counterAccountBankId: "",
            counterAccountBankName: "",
            counterAccountName: "",
            counterAccountNumber: "",
            virtualAccountName: "",
            virtualAccountNumber: "",
        },
        signature: "sandbox-placeholder",
    }) as const

/** The order code input every payOS inbound case takes. */
const ORDER_CODE_FIELD = {
    name: "orderCode",
    label: "Mã đơn payOS / payOS order code",
    kind: "integer",
    example: PAYOS_SANDBOX_FIRST_ORDER_CODE,
} as const

/**
 * The paid-order webhook of a link the account created (its order code is the one input, payOS's own word): the link id, the amount and
 * the description (the transfer content) are read back from the account's state when the account holds the link, else the id counts from
 * the first order code and the amount and description are fixed. The bank reference runs per account from `state.seq` (each paid order
 * is its own transaction, never a duplicate of the last) and the booking time is the send's moment.
 */
const paidCase: SandboxInboundCase = {
    trigger: "transaction.received",
    path: (connectionId) => `api/connections/payos/${connectionId}`,
    inputs: [ORDER_CODE_FIELD],
    eventsOf: async (input: SandboxInput, context) => {
        const orderCode = typeof input.orderCode === "number" ? input.orderCode : PAYOS_SANDBOX_FIRST_ORDER_CODE
        const keptLinkId = await context.state.read(ORDER_STATE, String(orderCode))
        const linkId = typeof keptLinkId === "string" ? keptLinkId : payosSandboxLinkId(context.connectionId, orderCode - PAYOS_SANDBOX_FIRST_ORDER_CODE + 1)
        const link = linkOf(await context.state.read(LINK_STATE, linkId))
        const keptAmount: unknown = link?.amountVnd
        const keptDescription = await context.state.read(PAYOS_SANDBOX_DESCRIPTION_STATE, linkId)
        // The paid webhook is how a link gets PAID (as live): a link still open is marked paid in full (the amount received kept) before the
        // webhook goes out; a cancelled, expired or already paid one is left as it is (a late or second payment changes no status).
        if (link !== null && link.status === PENDING && !lapsed(await context.state.read(PAYOS_SANDBOX_EXPIRY_STATE, linkId), context.at)) {
            const paid: PaymentLinkState = { ...link, status: "PAID", amountPaidVnd: link.amountVnd, amountRemainingVnd: 0 }
            await context.state.write(LINK_STATE, linkId, paid)
        }
        return [
            {
                body: paidBodyOf({
                    orderCode,
                    linkId,
                    amount: typeof keptAmount === "number" ? keptAmount : PAYOS_SANDBOX_DEFAULT_AMOUNT,
                    description: typeof keptDescription === "string" ? keptDescription : PAYOS_SANDBOX_DEFAULT_DESCRIPTION,
                    seq: context.state.seq,
                    at: context.at,
                }),
            },
        ]
    },
}

/** payOS's own sample order code (its webhook confirmation ping): `isPayosSample` in billing/payos.policy. */
const PAYOS_SANDBOX_SAMPLE_ORDER_CODE = 123

/**
 * A payOS delivery that books nothing, in payOS's body shape: `sample` is the confirmation ping payOS sends when the owner saves the webhook
 * (the sample order code 123), `notPaid` a result that is not a paid order (`success` false, a code other than `00`): the door acknowledges
 * both and books nothing (`readPayosDelivery`: reasons `sample` and `not_paid`). The link is untouched.
 */
const ignoredCase = (kind: "sample" | "notPaid"): SandboxInboundCase => ({
    trigger: "transaction.received",
    path: (connectionId) => `api/connections/payos/${connectionId}`,
    inputs: [],
    eventsOf: (_input: SandboxInput, context) => {
        const body = paidBodyOf({
            orderCode: kind === "sample" ? PAYOS_SANDBOX_SAMPLE_ORDER_CODE : PAYOS_SANDBOX_FIRST_ORDER_CODE,
            linkId: payosSandboxLinkId(context.connectionId, 1),
            amount: PAYOS_SANDBOX_DEFAULT_AMOUNT,
            description: PAYOS_SANDBOX_DEFAULT_DESCRIPTION,
            seq: context.state.seq,
            at: context.at,
        })
        return Promise.resolve([{ body: kind === "sample" ? body : { ...body, code: "01", desc: "failed", success: false } }])
    },
})

/** The state change a link takes when a case moves it out of PENDING by something other than a payment. */
const movedCase = (status: "CANCELLED" | "EXPIRED"): SandboxInboundCase => ({
    trigger: "link.status",
    path: (connectionId) => `api/connections/payos/${connectionId}`,
    inputs: [ORDER_CODE_FIELD],
    // payOS posts no webhook for it (its webhook is for paid orders: the parser ignores every other code): NIVO learns by reading the link.
    eventsOf: async (input: SandboxInput, context) => {
        const orderCode = typeof input.orderCode === "number" ? input.orderCode : PAYOS_SANDBOX_FIRST_ORDER_CODE
        const linkId = await context.state.read(ORDER_STATE, String(orderCode))
        const link = typeof linkId === "string" ? linkOf(await context.state.read(LINK_STATE, linkId)) : null
        if (link !== null && link.status === PENDING) {
            const moved: PaymentLinkState =
                status === "CANCELLED"
                    ? { ...link, status, canceledAt: payosTimeOf(context.at), cancellationReason: "customer cancelled at checkout" }
                    : { ...link, status }
            await context.state.write(LINK_STATE, link.linkId, moved)
        }
        return []
    },
})

/** The ids of the cases that pay a link (payOS posts the paid webhook; a payOS link is paid in full or not at all). */
const PAYOS_SANDBOX_PAYING_CASES = ["PAYOS-3"] as const

/**
 * How the Sandbox page resolves a payOS sandbox link by its id (SBX-6): the account is named by the id, the link read from the account's
 * kept state (the link, its description, its expiry). payOS words become the page's words: PENDING is `open` (or `expired` once past the
 * instant asked), PAID `paid`, CANCELLED `cancelled`, EXPIRED `expired`; what was received is the link's `amountPaidVnd` (a link left open
 * keeps what it was paid so far).
 */
export const PAYOS_SANDBOX_PAY_LINKS: SandboxPayLinks = {
    accountOf: payosSandboxLinkAccountOf,
    caseIds: PAYOS_SANDBOX_PAYING_CASES,
    read: async (linkId: string, state: SandboxStateReader, now: Date): Promise<SandboxPayLinkRead | null> => {
        const link = linkOf(await state(LINK_STATE, linkId))
        if (link === null) return null
        const description = await state(PAYOS_SANDBOX_DESCRIPTION_STATE, linkId)
        const lapsedNow = link.status === PENDING && lapsed(await state(PAYOS_SANDBOX_EXPIRY_STATE, linkId), now)
        const status = lapsedNow || link.status === "EXPIRED" ? "expired" : link.status === "PAID" ? "paid" : link.status === "CANCELLED" ? "cancelled" : "open"
        return {
            linkId: link.linkId,
            amountVnd: link.amountVnd,
            content: typeof description === "string" ? description : "",
            orderCode: String(link.orderCode),
            status,
            amountReceivedVnd: link.amountPaidVnd ?? 0,
        }
    },
    inputsOf: (link: SandboxPayLinkRead): SandboxInput => ({ orderCode: Number(link.orderCode) }),
}

/**
 * The hardcoded cases of payOS's sandbox (R62), for the payment-link port. OUTBOUND: the account's sticky NEXT CASE picks one per
 * operation and the default (success) case answers while nothing is picked: `create` PAYOS-1 (default, a PENDING link) or PAYOS-2
 * (refused), `get` PAYOS-4 (default, the kept link) or PAYOS-6 (not found), `cancel` PAYOS-5 (default, a PENDING link becomes
 * CANCELLED) or PAYOS-7 (refused, not pending). The request never picks a case; a link never created is still not found and a link
 * already cancelled is still refused a second cancel (the answer reads the state). INBOUND: PAYOS-3, the link is paid (payOS's webhook on
 * its real route, built from the order code). Link ids and order codes come from state, counting up per create.
 */
export const PAYOS_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: PAYOS_SANDBOX_PROVIDER,
    payLinks: PAYOS_SANDBOX_PAY_LINKS,
    cases: [
        {
            id: PAYOS_SANDBOX_CASE.created,
            outcome: "ok",
            label: "A payment link is created: a PENDING link, its id and order code counting up from the account's state",
            operation: PAYOS_SANDBOX_OPERATION.create,
            default: true,
        },
        {
            id: PAYOS_SANDBOX_CASE.createRefused,
            outcome: "refused",
            label: `A create is refused: payOS rejects it ("${PAYOS_SANDBOX_REFUSED_REASON}"), no link, no proof attached as live`,
            operation: PAYOS_SANDBOX_OPERATION.create,
        },
        {
            id: "PAYOS-3",
            label: "A link is paid: payOS posts the paid-order webhook (code 00) of the order code named (by default the account's first link) to NIVO's payOS route",
            inbound: paidCase,
        },
        {
            id: PAYOS_SANDBOX_CASE.read,
            outcome: "ok",
            label: "A link is read by its link id or its order code: the account's kept link, or the not-found refusal for one it never created",
            operation: PAYOS_SANDBOX_OPERATION.get,
            default: true,
        },
        {
            id: PAYOS_SANDBOX_CASE.cancelled,
            outcome: "ok",
            label: `A link is cancelled: a PENDING link becomes CANCELLED with the reason; a link that is not pending is rejected ("${PAYOS_SANDBOX_CANNOT_CANCEL_REASON}"); an unknown one is not found`,
            operation: PAYOS_SANDBOX_OPERATION.cancel,
            default: true,
        },
        {
            id: PAYOS_SANDBOX_CASE.readNotFound,
            outcome: "refused",
            label: "A link is not found: payOS answers not found to the read, whatever the reference",
            operation: PAYOS_SANDBOX_OPERATION.get,
        },
        {
            id: "PAYOS-8",
            label: "A paid webhook for an order code the account never issued: payOS posts the paid-order body (code 00) naming a code no link holds (the default code names none)",
            inbound: { ...paidCase, inputs: [{ ...ORDER_CODE_FIELD, example: PAYOS_SANDBOX_UNKNOWN_ORDER_CODE }] },
        },
        {
            id: "PAYOS-9",
            label: "The customer cancels at the checkout page: the pending link becomes CANCELLED (payOS posts no webhook for it; NIVO learns by reading the link)",
            inbound: movedCase("CANCELLED"),
        },
        {
            id: "PAYOS-10",
            label: "The link expires on demand: the pending link becomes EXPIRED now (payOS posts no webhook for it; NIVO learns by reading the link)",
            inbound: movedCase("EXPIRED"),
        },
        {
            id: "PAYOS-17",
            label: "payOS's confirmation ping: the sample order (code 123) payOS posts when the webhook is saved; the door acknowledges it and books nothing",
            inbound: ignoredCase("sample"),
        },
        {
            id: "PAYOS-18",
            label: "A result that is not a paid order (success false, a code other than 00): the door acknowledges it and books nothing",
            inbound: ignoredCase("notPaid"),
        },
        {
            id: PAYOS_SANDBOX_CASE.cancelRefused,
            outcome: "refused",
            label: `A cancel is refused: payOS rejects it ("${PAYOS_SANDBOX_CANNOT_CANCEL_REASON}"), the link stays as it was`,
            operation: PAYOS_SANDBOX_OPERATION.cancel,
        },
        ...(
            [
                ["createTransient", "create", "transient", "A create is answered 429 (too many requests): nothing was sent, the engine retries later"],
                ["createTimeout", "create", "timeout", "A create gets no answer in time: the link may exist, the outcome is unknown"],
                ["readTransient", "get", "transient", "A read is answered 429 (too many requests): nothing was sent, the engine retries later"],
                ["readTimeout", "get", "timeout", "A read gets no answer in time: the outcome is unknown"],
                ["cancelTransient", "cancel", "transient", "A cancel is answered 429 (too many requests): nothing was sent, the engine retries later"],
                ["cancelTimeout", "cancel", "timeout", "A cancel gets no answer in time: the link may be cancelled, the outcome is unknown"],
            ["createTimeoutApplied", "create", "timeout", "A create gets no answer in time, but the link WAS created: the outcome is unknown, a read finds the link PENDING"],
            ["cancelTimeoutApplied", "cancel", "timeout", "A cancel gets no answer in time, but the link WAS cancelled: the outcome is unknown, a read finds the link CANCELLED"],
            ] as const
        ).map(([key, operation, outcome, label]) => ({
            id: PAYOS_SANDBOX_CASE[key],
            label,
            operation: PAYOS_SANDBOX_OPERATION[operation],
            outcome,
        })),
    ],
}
