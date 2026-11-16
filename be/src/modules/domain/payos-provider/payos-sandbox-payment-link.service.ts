import { Injectable } from "@nestjs/common"
import type { ConnectionRecord } from "@modules/domain/connections"
import {
    providerRefusal,
    withProof,
    type PaymentLink,
    type PaymentLinkPort,
    type PaymentLinkRef,
    type PaymentLinkRequest,
    type PaymentLinkState,
} from "@modules/domain/provider-registry"
import { ProviderSandboxService, type SandboxState } from "@modules/domain/provider-sandbox"
import { PayosError, PayosErrorCode } from "@modules/integrations/payos"
import { HttpError, HttpErrorCode } from "@modules/platform/http"
import {
    PAYOS_SANDBOX_AT,
    PAYOS_SANDBOX_CANNOT_CANCEL_REASON,
    PAYOS_SANDBOX_CASE,
    PAYOS_SANDBOX_DESCRIPTION_STATE,
    PAYOS_SANDBOX_EXPIRY_STATE,
    PAYOS_SANDBOX_FIRST_ORDER_CODE,
    PAYOS_SANDBOX_OPERATION,
    PAYOS_SANDBOX_PROVIDER,
    PAYOS_SANDBOX_QR_PAYLOAD,
    PAYOS_SANDBOX_REFUSED_REASON,
    payosSandboxLinkId,
} from "./payos-sandbox.catalogue"

/** State name: the links the account created, by link id (a `PaymentLinkState`). */
const LINK = "link"

/** State name: the link id of an order code, by the code's text. */
const ORDER = "order"

/**
 * The failure the LIVE client throws for a 429 (`PayosError` `RateLimited`), as the live adapter types it (`payosFailureOf`): refused at the
 * gateway, it proves `not_sent`. The same error the live road throws, so the engine's one classifier reads it the same way (`transient`):
 * a sandbox twin that threw an untyped error made the engine class a rate limit as a fault of the code (D3-W2-10 / D3-W2-11).
 */
const tooMany = (): PayosError => withProof(new PayosError({ code: PayosErrorCode.RateLimited }), "not_sent")

/**
 * The failure the LIVE client throws for a call that got no answer in time (`PayosError` `Unreachable` over the transport's deadline,
 * `HttpError` `Timeout`), as the live adapter types it: `unknown` (a signed POST that timed out may have created the link; a read has no effect).
 */
const noAnswer = (): PayosError =>
    withProof(new PayosError({ code: PayosErrorCode.Unreachable, cause: new HttpError({ code: HttpErrorCode.Timeout }) }), "unknown")

/** The failure of a transient or timeout case, as the live road throws it (`tooMany`, `noAnswer`). */
const failureOf = (state: SandboxState, transient: string, timeout: string): void => {
    if (state.nextCase === transient) throw tooMany()
    if (state.nextCase === timeout) throw noAnswer()
}

/** Whether the case is one where the call got no answer but its effect WAS applied (the state is written first, then the answer is lost). */
const appliedThenLost = (state: SandboxState, id: string): boolean => state.nextCase === id

/** The path id of a link reference: the link id or the order code's text (the live path takes either). */
const idOf = (ref: PaymentLinkRef): string => ("linkId" in ref ? ref.linkId : String(ref.orderCode))

/** A kept link of the account's state by a link reference, or null when the account never created it. */
const heldOf = async (state: SandboxState, ref: PaymentLinkRef): Promise<PaymentLinkState | null> => {
    const linkId = "linkId" in ref ? ref.linkId : await state.read(ORDER, String(ref.orderCode))
    if (typeof linkId !== "string") return null
    const kept = await state.read(LINK, linkId)
    return kept === null ? null : (kept as PaymentLinkState)
}

@Injectable()
/**
 * payOS's SANDBOX implementation of the payment-link port (rulings R56 / R59 / R60): used when the provider account is a sandbox account.
 * It answers through the generic sandbox frame from the hardcoded catalogue (`PAYOS_SANDBOX_CATALOGUE`), reaches no host and holds no
 * secret; the frame logs every call.
 *
 * A create makes a PENDING link whose id and order code count up from the account's state (`state.seq` of the create operation:
 * `sbx-payos-link-000001` / order code 1780000000001, then 000002 / ...002); the link is kept, by link id and by order code, so a get and a
 * cancel find it, with its description (the paid webhook's transfer content). The account's NEXT CASE `PAYOS-2` makes the create refused
 * `rejected` as live payOS refuses a duplicate order (no proof attached, as the live adapter throws it); the request never picks a
 * case (R62), and the same holds for the get (`PAYOS-6`) and the cancel (`PAYOS-7`). A get answers the kept link, or the `not_found` refusal for a link the account never created. A cancel turns a
 * PENDING link into CANCELLED with the reason; any other status is refused `rejected`. The PAID state of a link arrives the way live payOS
 * does it: its inbound webhook (PAYOS-3) on NIVO's route, never through this port.
 *
 * Not mirrored from the live adapter: its pre-send check of `expiresAt` (an instant outside Int32 seconds is refused `rejected`); the
 * sandbox echoes the instant asked. No dedupe: a second create makes a second link, as live does.
 */
export class PayosSandboxPaymentLinkService implements PaymentLinkPort {
    /** The provider key. */
    readonly provider: typeof PAYOS_SANDBOX_PROVIDER = PAYOS_SANDBOX_PROVIDER

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** Creates a link through exactly one sandbox call (logged under the description; the case is the account's next case). */
    async create(connection: ConnectionRecord, request: PaymentLinkRequest): Promise<PaymentLink> {
        return await this.sandbox.call(connection, PAYOS_SANDBOX_OPERATION.create, request, {
            key: request.description,
            answer: async (state) => {
                failureOf(state, PAYOS_SANDBOX_CASE.createTransient, PAYOS_SANDBOX_CASE.createTimeout)
                if (state.nextCase === PAYOS_SANDBOX_CASE.createRefused) {
                    throw providerRefusal(PAYOS_SANDBOX_PROVIDER, "rejected", PAYOS_SANDBOX_REFUSED_REASON)
                }
                const linkId = payosSandboxLinkId(connection.id, state.seq + 1)
                const orderCode = PAYOS_SANDBOX_FIRST_ORDER_CODE + state.seq
                const kept: PaymentLinkState = {
                    linkId,
                    orderCode,
                    amountVnd: request.amountVnd,
                    amountPaidVnd: 0,
                    amountRemainingVnd: request.amountVnd,
                    status: "PENDING",
                    createdAt: PAYOS_SANDBOX_AT,
                }
                await state.write(LINK, linkId, kept)
                await state.write(ORDER, String(orderCode), linkId)
                await state.write(PAYOS_SANDBOX_DESCRIPTION_STATE, linkId, request.description)
                if (request.expiresAt !== undefined) await state.write(PAYOS_SANDBOX_EXPIRY_STATE, linkId, request.expiresAt)
                if (appliedThenLost(state, PAYOS_SANDBOX_CASE.createTimeoutApplied)) throw noAnswer()
                return {
                    linkId,
                    orderCode,
                    checkoutUrl: this.sandbox.payPageUrl(connection, linkId),
                    qrPayload: PAYOS_SANDBOX_QR_PAYLOAD,
                    amountVnd: request.amountVnd,
                    description: request.description,
                    status: "PENDING",
                    ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
                }
            },
        })
    }

    /** Reads a link through exactly one sandbox call keyed by its id or order code. */
    async get(connection: ConnectionRecord, ref: PaymentLinkRef): Promise<PaymentLinkState> {
        return await this.sandbox.call(connection, PAYOS_SANDBOX_OPERATION.get, { ref }, {
            key: idOf(ref),
            answer: async (state) => {
                failureOf(state, PAYOS_SANDBOX_CASE.readTransient, PAYOS_SANDBOX_CASE.readTimeout)
                if (state.nextCase === PAYOS_SANDBOX_CASE.readNotFound) throw providerRefusal(PAYOS_SANDBOX_PROVIDER, "not_found")
                const held = await heldOf(state, ref)
                if (held === null) throw providerRefusal(PAYOS_SANDBOX_PROVIDER, "not_found")
                return held
            },
        })
    }

    /** Cancels a link through exactly one sandbox call keyed by its id or order code. */
    async cancel(connection: ConnectionRecord, ref: PaymentLinkRef, reason: string | undefined): Promise<PaymentLinkState> {
        return await this.sandbox.call(connection, PAYOS_SANDBOX_OPERATION.cancel, { ref, reason: reason ?? null }, {
            key: idOf(ref),
            answer: async (state) => {
                failureOf(state, PAYOS_SANDBOX_CASE.cancelTransient, PAYOS_SANDBOX_CASE.cancelTimeout)
                if (state.nextCase === PAYOS_SANDBOX_CASE.cancelRefused) {
                    throw providerRefusal(PAYOS_SANDBOX_PROVIDER, "rejected", PAYOS_SANDBOX_CANNOT_CANCEL_REASON)
                }
                const held = await heldOf(state, ref)
                if (held === null) throw providerRefusal(PAYOS_SANDBOX_PROVIDER, "not_found")
                if (held.status !== "PENDING") throw providerRefusal(PAYOS_SANDBOX_PROVIDER, "rejected", PAYOS_SANDBOX_CANNOT_CANCEL_REASON)
                const cancelled: PaymentLinkState = {
                    ...held,
                    status: "CANCELLED",
                    canceledAt: PAYOS_SANDBOX_AT,
                    ...(reason === undefined ? {} : { cancellationReason: reason }),
                }
                await state.write(LINK, held.linkId, cancelled)
                if (appliedThenLost(state, PAYOS_SANDBOX_CASE.cancelTimeoutApplied)) throw noAnswer()
                return cancelled
            },
        })
    }
}
