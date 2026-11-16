import { Injectable } from "@nestjs/common"
import { ChannelsError, ChannelsErrorCode } from "@modules/domain/channels"
import type { ChannelTarget, CustomerSendPort, CustomerSendRequest, DeliveryResult } from "@modules/domain/channels"
import type { ConnectionRecord } from "@modules/domain/connections"
import { ProviderSandboxService, type SandboxState } from "@modules/domain/provider-sandbox"
import { META_REPLY_WINDOW_MS, metaLastLineAt } from "./meta-sandbox.catalogue"
import { META_SANDBOX_DELIVERED_STATE, META_SEND_CASE, META_SEND_OPERATION } from "./meta-sandbox-send.catalogue"

/** Delivered as the live Page sender answers its yes. */
const DELIVERED: DeliveryResult = { delivered: true, failure: null, outcome: "acknowledged" }

/** The live receipt of the Page sender's no (the Page is gone, Meta refused, the window is closed, Meta did not answer): the outcome is not known. */
const UNKNOWN: DeliveryResult = { delivered: false, failure: null, outcome: "ambiguous" }

/** What the live send throws for Meta's "not now" before any part went out: the port's one not-sent answer, the reason `meta_<Meta's reason>`. */
const NOT_SENT = (reason: "rate_limited" | "unavailable"): ChannelsError =>
    new ChannelsError({ code: ChannelsErrorCode.SendUnavailable, params: { reason: `meta_${reason}` } })

/** Counts one more message that reached the person (what Meta delivered, whatever Meta then answered). */
const delivered = async (state: SandboxState, personId: string): Promise<void> => {
    const kept = await state.read(META_SANDBOX_DELIVERED_STATE, personId)
    await state.write(META_SANDBOX_DELIVERED_STATE, personId, (typeof kept === "number" ? kept : 0) + 1)
}

@Injectable()
/**
 * The sandbox twin of the Meta customer send, Messenger and Instagram (`META-SEND-1` .. `9`): it records the send and never reaches Meta.
 * A person whose last line (sandbox state `last-line`, kept by the inbound cases) is more than 24 hours before the request's moment is
 * refused, whatever case the account picked; a person who never wrote is open. Otherwise the account's next case answers, with the live
 * port's own answers: delivered (default); the unknown-outcome receipt for a refusal (window closed, token refused, recipient
 * unavailable), a timeout, a part-delivered text whose rest was stopped, and a lost answer of a delivered message; and the port's
 * not-sent error `CHANNELS_SEND_UNAVAILABLE` (reason `meta_rate_limited` or `meta_unavailable`) for Meta's "not now" before any part
 * went out. What reached a person is counted in the state `delivered`. One logged call per send.
 */
export class MetaSandboxSendService implements CustomerSendPort {
    readonly provider = "meta"

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** Answers one send of a sandbox account from the window rule and the account's next case; one logged call per send. */
    send(
        account: ConnectionRecord,
        _target: ChannelTarget,
        userId: string | null,
        request: CustomerSendRequest,
    ): Promise<DeliveryResult> {
        return this.sandbox.call(
            account,
            META_SEND_OPERATION,
            { userId, text: request.text, images: request.images ?? [] },
            {
                key: userId ?? "",
                answer: async (state) => {
                    if (userId === null) return UNKNOWN
                    const last = await metaLastLineAt(state, userId)
                    if (last !== null && request.at.getTime() - last > META_REPLY_WINDOW_MS) return UNKNOWN
                    switch (state.nextCase) {
                        case META_SEND_CASE.windowClosed:
                        case META_SEND_CASE.timeout:
                        case META_SEND_CASE.tokenRefused:
                        case META_SEND_CASE.recipientUnavailable:
                            return UNKNOWN
                        case META_SEND_CASE.rateLimited:
                            throw NOT_SENT("rate_limited")
                        case META_SEND_CASE.unavailable:
                            throw NOT_SENT("unavailable")
                        case META_SEND_CASE.partial:
                        case META_SEND_CASE.appliedNoAnswer:
                            await delivered(state, userId)
                            return UNKNOWN
                        default:
                            await delivered(state, userId)
                            return DELIVERED
                    }
                },
            },
        )
    }
}
