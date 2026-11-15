import { Injectable } from "@nestjs/common"
import type { ConnectionRecord } from "@modules/domain/connections"
import { ProviderSandboxService, type SandboxState } from "@modules/domain/provider-sandbox"
import { WEBHOOK_CASE, WEBHOOK_DELIVER_OPERATION, WEBHOOK_SANDBOX_PROVIDER, WEBHOOK_SANDBOX_RECEIVED_STATE } from "./webhook-sandbox.catalogue"
import type { WebhookSendPort, WebhookSendRequest, WebhookSendResult } from "./webhook-send.port"

/** How long every sandbox delivery "takes" (fixed: the same answer on every machine, no clock). */
const DURATION_MS = 12

/** The header the signed delivery carries its id in: what the call log keys the delivery by. */
const DELIVERY_HEADER = "x-nivo-delivery"

/** The receiver's answer of an outgoing case: a status. */
const answered = (status: number): WebhookSendResult => ({ status, failure: null, durationMs: DURATION_MS })

/** The answer of the account's picked case (`WEBHOOK-7` while none is picked). */
const answerOf = (state: SandboxState): WebhookSendResult => {
    switch (state.nextCase) {
        case WEBHOOK_CASE.refused:
            return answered(400)
        case WEBHOOK_CASE.rateLimited:
            return answered(429)
        case WEBHOOK_CASE.serverError:
            return answered(503)
        case WEBHOOK_CASE.signatureRefused:
            return answered(401)
        case WEBHOOK_CASE.endpointGone:
            return answered(410)
        case WEBHOOK_CASE.noAnswer:
        case WEBHOOK_CASE.noAnswerButReceived:
            return { status: null, failure: "timeout", durationMs: DURATION_MS }
        case WEBHOOK_CASE.unreachable:
            return { status: null, failure: "unreachable", durationMs: DURATION_MS }
        default:
            return answered(200)
    }
}

@Injectable()
/**
 * The generic webhook's SANDBOX implementation of the outgoing port (R56 / R62): used when the webhook account is a sandbox account. It
 * answers through the generic sandbox frame from the hardcoded catalogue (`WEBHOOK_SANDBOX_CATALOGUE`), posts to no host and reads no
 * address (a sandbox account holds none); one logged call per delivery, keyed by the delivery id, the call log keeping the signed body and
 * headers the receiver would have got.
 *
 * The account's sticky NEXT CASE of `deliver` picks what the receiver answers, never the delivery: `WEBHOOK-7` (default) HTTP 200,
 * `-8` HTTP 400 (refused for good), `-9` 429 and `-10` 503 (the queue retries), `-11` no answer in time (`failure: timeout`, the
 * outcome unknown; `-16` the same, but the delivery WAS received: kept in state `received`) and `-12` unreachable (`failure: unreachable`), `-14` HTTP 401 and `-15` HTTP 410 (refused for good). Like live, the verdict of the status is the caller's (the same
 * `deliveryVerdict` reads a live and a sandbox answer), and a second call delivers again.
 */
export class WebhookSandboxSendService implements WebhookSendPort {
    /** The provider key. */
    readonly provider: typeof WEBHOOK_SANDBOX_PROVIDER = WEBHOOK_SANDBOX_PROVIDER

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** Answers one signed delivery by the account's next case of `deliver`. */
    async post(connection: ConnectionRecord, request: WebhookSendRequest): Promise<WebhookSendResult> {
        return await this.sandbox.call(connection, WEBHOOK_DELIVER_OPERATION, request, {
            key: request.headers[DELIVERY_HEADER] ?? "",
            answer: async (state) => {
                // WEBHOOK-16: the receiver took the delivery (kept by its delivery id) and the answer never came.
                if (state.nextCase === WEBHOOK_CASE.noAnswerButReceived) await state.write(WEBHOOK_SANDBOX_RECEIVED_STATE, request.headers[DELIVERY_HEADER] ?? "", true)
                return answerOf(state)
            },
        })
    }
}
