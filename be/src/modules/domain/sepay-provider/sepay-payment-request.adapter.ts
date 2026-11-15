import type { ConnectionRecord } from "@modules/domain/connections"
import type {
    PaymentInstructionPort,
    PaymentRequest,
    PaymentRequestAsk,
    PaymentRequestPort,
} from "@modules/domain/provider-registry"

/**
 * SePay's adapter of the payment-request purpose (owner ruling R111), over its own bank-transfer instruction port (the live service or its
 * sandbox twin, so both answer the neutral port the same way): the payer transfers the amount into the connection's receiving account and
 * writes the caller's reference as the transfer content. Nothing is created at SePay, so it keeps NO request: it implements `create` only,
 * and the tool answers `get` / `cancel` with `no_request_state`. No `requestRef`: a credit is recognised by the transfer content the payer
 * wrote (SePay names no request of its own; its webhook's `code` is the shop's configured payment-code extraction, not verified here).
 */
export class SepayPaymentRequestAdapter implements PaymentRequestPort {
    readonly provider: string

    constructor(private readonly instructions: PaymentInstructionPort) {
        this.provider = instructions.provider
    }

    /** The transfer instruction in the neutral words; always `open` (nothing at the provider can move it). */
    async create(connection: ConnectionRecord, ask: PaymentRequestAsk): Promise<PaymentRequest> {
        const instruction = await this.instructions.transfer(connection, { amountVnd: ask.amountVnd, content: ask.reference })
        return {
            amountVnd: instruction.amountVnd,
            reference: ask.reference,
            status: "open",
            ...(instruction.qrImageUrl === undefined ? {} : { qrImageUrl: instruction.qrImageUrl }),
            ...(instruction.qrPayload === undefined ? {} : { qrPayload: instruction.qrPayload }),
            transferContent: instruction.content,
            payKey: instruction.content,
            bank: {
                accountNumber: instruction.accountNumber,
                ...(instruction.bankCode === undefined ? {} : { code: instruction.bankCode }),
                ...(instruction.bankName === undefined ? {} : { name: instruction.bankName }),
                ...(instruction.accountHolder === undefined ? {} : { holder: instruction.accountHolder }),
            },
            ...(instruction.expiresAt === undefined ? {} : { expiresAt: instruction.expiresAt }),
        }
    }
}
