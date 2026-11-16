import { Injectable } from "@nestjs/common"
import type { ConnectionRecord } from "@modules/domain/connections"
import {
    providerCallFailure,
    providerRefusal,
    withProof,
    type TemplateMessagePort,
    type TemplateMessageRequest,
    type TemplateMessageSent,
} from "@modules/domain/provider-registry"
import { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import { ZNS_CASE, ZNS_SANDBOX_REFUSALS, ZNS_SEND_OPERATION, ZNS_SENT_STATE } from "./zalo-zns-sandbox.catalogue"
import { ZALO_ZNS_PROVIDER } from "./zalo-zns-template.service"

/** What the sandbox says when a call times out (the cause of the registry's unknown failure). */
const NO_ANSWER = "sandbox: no answer in time"

/** The running message id of the nth accepted send of this operation (`state.seq` counts the calls before it). */
const messageIdOf = (seq: number): string => `SBX-ZNS-${String(seq + 1).padStart(6, "0")}`

@Injectable()
/**
 * The sandbox twin of the ZNS template send (`ZNS-1..7`): the account's NEXT CASE of `sendTemplate` picks the answer (sticky; `ZNS-1`
 * while nothing is picked); the request's template id picks nothing. The accepted send answers a running message id. A refusing case
 * (template not found, quota used up, the OA's token refused) is the platform's answer about the request, proved `not_sent` (the same typed
 * refusals the live adapter throws); "not now" is the registry's not-sent failure and a missing answer its unknown failure (the generic
 * words the tool runner reads the proof from). `ZNS-6` sends the message and loses the answer (the message is in the state `sent`). The
 * live send refuses everything `not_available` until its documentation is read, so it has no real error shape for these; the reasons are the
 * registry's generic words, and the provider's own error numbers are NOT guessed. It never calls Zalo.
 */
export class ZaloZnsSandboxTemplateService implements TemplateMessagePort {
    readonly provider: string = ZALO_ZNS_PROVIDER

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** Sends the template, or answers as the account's next case says. */
    sendTemplate(connection: ConnectionRecord, request: TemplateMessageRequest): Promise<TemplateMessageSent> {
        return this.sandbox.call(connection, ZNS_SEND_OPERATION, request, {
            key: request.templateId,
            answer: async (state) => {
                const refusal = state.nextCase === null ? undefined : ZNS_SANDBOX_REFUSALS[state.nextCase]
                if (refusal !== undefined) throw withProof(providerRefusal(ZALO_ZNS_PROVIDER, refusal.reason, refusal.detail), "not_sent")
                if (state.nextCase === ZNS_CASE.notNow) throw providerCallFailure("not_sent", new Error(NO_ANSWER))
                if (state.nextCase === ZNS_CASE.timeout) throw providerCallFailure("unknown", new Error(NO_ANSWER))
                const messageId = messageIdOf(state.seq)
                if (state.nextCase === ZNS_CASE.appliedNoAnswer) {
                    await state.write(ZNS_SENT_STATE, messageId, { phone: request.phone, templateId: request.templateId })
                    throw providerCallFailure("unknown", new Error(NO_ANSWER))
                }
                return { messageId }
            },
        })
    }
}
