import type {
    SandboxCase,
    SandboxCatalogue,
    SandboxInboundCase,
    SandboxInboundContext,
    SandboxInput,
    SandboxInputField,
    SandboxWebhookEvent,
} from "@modules/domain/provider-sandbox"

/** The provider key of the SePay catalogue. */
export const SEPAY_SANDBOX_PROVIDER = "sepay"

/** The receiving bank account every sandbox SePay account owns (fixed, the same on every machine). */
export const SEPAY_SANDBOX_ACCOUNT = {
    accountNumber: "0011004455667",
    bankCode: "VCB",
    bankName: "Vietcombank",
    accountHolder: "NIVO SANDBOX SHOP",
} as const

/** The operation of the payment instruction in the sandbox call log and in the account's next-case selector. */
export const SEPAY_SANDBOX_TRANSFER_OPERATION = "transfer"

/** The FIXED deviation of the short and the over payment (owner, R62): 1,000 VND. */
export const SEPAY_SANDBOX_DEVIATION_VND = 1000

/** The first transaction id of a sandbox account; each send takes the next (`+ seq`), so ids are deterministic per account. */
export const SEPAY_SANDBOX_FIRST_ID = 9100001

/** The balance of the receiving account before any movement (the `accumulated` of SePay's body runs from it). */
export const SEPAY_SANDBOX_OPENING_BALANCE = 5_000_000

/** The state name the bank movements a case made are kept under (the poll and the list read them back, as SePay lists them). */
export const SEPAY_SANDBOX_MOVEMENTS_STATE = "movements"

/** The body of SePay's webhook for one money movement, in SePay's own field names (the shape its docs state). */
export interface SepaySandboxBody {
    readonly id: number
    readonly gateway: string
    readonly transactionDate: string
    readonly accountNumber: string
    readonly code: string | null
    readonly content: string
    readonly transferType: "in" | "out"
    readonly transferAmount: number
    readonly accumulated: number
    readonly subAccount: string | null
    readonly referenceCode: string
    readonly description: string
}

/** What the bank does in one case: the direction, the amount and the content of the movement (how often SePay posts it is the generic delivery mode). */
interface SepayMovementPlan {
    readonly transferType: "in" | "out"
    readonly amount: number
    readonly content: string
    /** True: SePay reports the SAME bank reference (`referenceCode`) as the account's latest movement, under a NEW transaction id. */
    readonly sameReferenceAsLast?: true
}

/** The two inputs of every SePay case (R62): bank words only, the transfer content and the amount the payer was asked for. */
const INPUTS: ReadonlyArray<SandboxInputField> = [
    { name: "content", label: "Nội dung chuyển khoản / Transfer content", kind: "text", example: "NIVO DH1001" },
    { name: "amount", label: "Số tiền (VND) / Amount (VND)", kind: "integer", example: 350_000 },
]

/** The inputs read back (the send checked their kinds against `INPUTS`). */
const readInput = (input: SandboxInput): { readonly content: string; readonly amount: number } => ({
    content: typeof input.content === "string" ? input.content : "",
    amount: typeof input.amount === "number" ? input.amount : 0,
})

/**
 * A reference that names nothing the payer was asked for (`SEPAY-7`): the content with every digit turned to 0 (`NIVO DH1001` ->
 * `NIVO DH0000`), or, for a content with no digit, the content followed by ` 000000`. Same shape, names no request.
 */
export const unknownReferenceOf = (content: string): string => (/\d/u.test(content) ? content.replace(/\d/gu, "0") : `${content} 000000`)

/** SePay's booking time text (Vietnam time, UTC+7, no zone) of an instant. */
export const sepayTimeOf = (at: Date): string => new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ")

/** The movements a sandbox account's cases made, oldest first (empty for a new account). */
export const sepayMovementsOf = (kept: unknown): ReadonlyArray<SepaySandboxBody> =>
    Array.isArray(kept) ? kept.filter((one): one is SepaySandboxBody => typeof one === "object" && one !== null && "id" in one) : []

/** The running balance after the account's kept movements. */
const balanceOf = (movements: ReadonlyArray<SepaySandboxBody>): number =>
    movements.reduce((sum, one) => sum + (one.transferType === "in" ? one.transferAmount : -one.transferAmount), SEPAY_SANDBOX_OPENING_BALANCE)

/** The webhook route of a SePay workspace feed on NIVO for one account. */
const sepayRoute = (connectionId: string): string => `api/connections/sepay/${connectionId}`

/**
 * One SePay inbound case: the plan's movement becomes ONE bank transaction (id `9100001 + seq`, booked at the send's moment, the
 * account's running balance), kept in the account's state so the poll and the list read it back (so every case is `polled`: it can be
 * delivered `withheld`). How often and when it reaches NIVO is the frame's generic delivery mode (`delivery` here names one).
 */
const caseOf = (
    plan: (input: { readonly content: string; readonly amount: number }) => SepayMovementPlan,
    delivery?: SandboxInboundCase["delivery"],
): SandboxInboundCase => ({
    trigger: "transaction.received",
    path: sepayRoute,
    inputs: INPUTS,
    polled: true,
    ...(delivery === undefined ? {} : { delivery }),
    eventsOf: async (input: SandboxInput, context: SandboxInboundContext): Promise<ReadonlyArray<SandboxWebhookEvent>> => {
        const movement = plan(readInput(input))
        const kept = sepayMovementsOf(await context.state.read(SEPAY_SANDBOX_MOVEMENTS_STATE, ""))
        const id = SEPAY_SANDBOX_FIRST_ID + context.state.seq
        const balance = balanceOf(kept) + (movement.transferType === "in" ? movement.amount : -movement.amount)
        const body: SepaySandboxBody = {
            id,
            gateway: SEPAY_SANDBOX_ACCOUNT.bankName,
            transactionDate: sepayTimeOf(context.at),
            accountNumber: SEPAY_SANDBOX_ACCOUNT.accountNumber,
            code: null,
            content: movement.content,
            transferType: movement.transferType,
            transferAmount: movement.amount,
            accumulated: balance,
            subAccount: null,
            // The bank's own reference: the latest movement's when the case repeats it under a new id, else one per transaction.
            referenceCode: movement.sameReferenceAsLast === true && kept.length > 0 ? (kept[kept.length - 1]?.referenceCode ?? `FT26${String(id)}`) : `FT26${String(id)}`,
            description: movement.content === "" ? "" : `BankAPINotify ${movement.content}`,
        }
        await context.state.write(SEPAY_SANDBOX_MOVEMENTS_STATE, "", [...kept, body])
        return [{ body }]
    },
})

/**
 * One SePay delivery that is NOT a money movement of the feed, kept nowhere (no state, so no poll lists it): the body as SePay writes it
 * but with NO transaction id. With no money it is SePay's TEST PING (the door acknowledges it, traces it, books nothing); with money it is a
 * delivery the door REFUSES as invalid so a real credit is never lost (`isSepayPing`, `readSepayPayload` in sepay-webhook.policy).
 */
const noIdCase = (transferAmount: (input: { readonly amount: number }) => number): SandboxInboundCase => ({
    trigger: "transaction.received",
    path: sepayRoute,
    inputs: INPUTS,
    eventsOf: (input: SandboxInput, context: SandboxInboundContext): Promise<ReadonlyArray<SandboxWebhookEvent>> => {
        const { content, amount } = readInput(input)
        return Promise.resolve([
            {
                body: {
                    gateway: SEPAY_SANDBOX_ACCOUNT.bankName,
                    transactionDate: sepayTimeOf(context.at),
                    accountNumber: SEPAY_SANDBOX_ACCOUNT.accountNumber,
                    code: null,
                    content,
                    transferType: "in",
                    transferAmount: transferAmount({ amount }),
                    subAccount: null,
                    description: content === "" ? "" : `BankAPINotify ${content}`,
                },
            },
        ])
    },
})

/**
 * SePay's hardcoded sandbox cases (owner ruling R62): each a named TRANSFORMATION of `{ content, amount }` (prefilled from the account's
 * latest payment instruction) into the webhook body SePay posts on `api/connections/sepay/<connectionId>`. The sandbox knows bank words
 * only (content, amount), never an order. The deviation of a short or an over payment is a FIXED 1,000 VND.
 */
export const SEPAY_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: SEPAY_SANDBOX_PROVIDER,
    prefill: {
        operation: SEPAY_SANDBOX_TRANSFER_OPERATION,
        inputOf: (request: unknown): SandboxInput | null => {
            if (typeof request !== "object" || request === null) return null
            const content: unknown = Reflect.get(request, "content")
            const amount: unknown = Reflect.get(request, "amountVnd")
            return typeof content === "string" && typeof amount === "number" ? { content, amount } : null
        },
    },
    cases: [
        {
            id: "SEPAY-1",
            label: "Paid in full: money in with the content and the exact amount",
            inbound: caseOf(({ content, amount }) => ({ transferType: "in", amount, content })),
        },
        {
            id: "SEPAY-2",
            label: "Short by 1,000 VND: money in with the content, amount - 1,000",
            inbound: caseOf(({ content, amount }) => ({ transferType: "in", amount: amount - SEPAY_SANDBOX_DEVIATION_VND, content })),
        },
        {
            id: "SEPAY-3",
            label: "Over by 1,000 VND: money in with the content, amount + 1,000",
            inbound: caseOf(({ content, amount }) => ({ transferType: "in", amount: amount + SEPAY_SANDBOX_DEVIATION_VND, content })),
        },
        {
            id: "SEPAY-4",
            label: "No content: money in with the exact amount and an EMPTY transfer content",
            inbound: caseOf(({ amount }) => ({ transferType: "in", amount, content: "" })),
        },
        {
            id: "SEPAY-5",
            label: "Money OUT: a debit of the amount with the content",
            inbound: caseOf(({ content, amount }) => ({ transferType: "out", amount, content })),
        },
        {
            id: "SEPAY-6",
            label: "Delivered twice: the SAME transaction (same id) posted two times, paid in full (SEPAY-1 with the generic `twice` delivery)",
            inbound: caseOf(({ content, amount }) => ({ transferType: "in", amount, content }), { mode: "twice" }),
        },
        {
            id: "SEPAY-7",
            label: "A reference naming nothing asked: the exact amount, the content's digits turned to 0",
            inbound: caseOf(({ content, amount }) => ({ transferType: "in", amount, content: unknownReferenceOf(content) })),
        },
        {
            id: "SEPAY-10",
            label: "The same bank reference under a NEW transaction id: money in with the content and the amount, the reference code of the account's latest movement (a second feed line for one bank transfer)",
            inbound: caseOf(({ content, amount }) => ({ transferType: "in", amount, content, sameReferenceAsLast: true })),
        },
        {
            id: "SEPAY-11",
            label: "SePay's test ping: a delivery with no transaction id and no money; the door acknowledges and books nothing",
            inbound: noIdCase(() => 0),
        },
        {
            id: "SEPAY-12",
            label: "Money with no transaction id: a delivery the door refuses as invalid (a real credit is never lost), nothing kept",
            inbound: noIdCase(({ amount }) => amount),
        },
        {
            id: "SEPAY-8",
            label: "The payment instruction is given: the catalogue's receiving account, the amount and content asked, the VietQR link",
            operation: SEPAY_SANDBOX_TRANSFER_OPERATION,
            outcome: "ok",
            default: true,
        },
        {
            id: "SEPAY-9",
            label: "The payment instruction is refused: the account has no receiving account number or bank code (no_credential), nothing issued",
            operation: SEPAY_SANDBOX_TRANSFER_OPERATION,
            outcome: "refused",
        },
    ] satisfies ReadonlyArray<SandboxCase>,
}
