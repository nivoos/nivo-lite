import { Injectable } from "@nestjs/common"
import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { ConnectionRecord } from "@modules/domain/connections"
import {
    providerRefusal,
    withProof,
    type FacebookPostRequest,
    type FacebookPostResult,
    type FacebookPublishPort,
} from "@modules/domain/provider-registry"
import { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import {
    FACEBOOK_CASE,
    FACEBOOK_PUBLISH_OPERATION,
    FACEBOOK_SANDBOX_PAGE_ID,
    FACEBOOK_SANDBOX_REFUSALS,
} from "./meta-facebook-sandbox.catalogue"
import { metaPublishingRateLimited, metaPublishingServerError, metaPublishingUnreachable } from "./meta-publishing-sandbox.failures"

/** State name: the posts the account made, by post key (the post id, or the video id for a video). */
const POST = "post"

/** The running number of a reference: six digits. */
const numberOf = (seq: number): string => String(seq + 1).padStart(6, "0")

/** The receipt of an accepted post: its shape follows the request's media, as the live Page edges answer. */
const receiptOf = (request: FacebookPostRequest, seq: number): FacebookPostResult => {
    const postId = `${FACEBOOK_SANDBOX_PAGE_ID}_${numberOf(seq)}`
    if (request.media === null) return { kind: request.link === null ? "text" : "link", postId, mediaId: null }
    if (request.media.kind === "photo") return { kind: "photo", postId, mediaId: `sbx-photo-${numberOf(seq)}` }
    return { kind: "video", postId: null, mediaId: `sbx-video-${numberOf(seq)}` }
}

@Injectable()
/**
 * Meta's SANDBOX implementation of the Facebook destination (`FacebookPublishPort`; owner rulings R56, R59, R60, R62): used when the Meta
 * account is a sandbox account. It answers through the generic sandbox frame from the hardcoded `FACEBOOK-<n>` catalogue and never
 * reaches a host. The account's NEXT CASE of the operation `facebook.publish` picks the answer (sticky; `FACEBOOK-1` while nothing is
 * picked); the request's words pick nothing. A post with no message, link or media is refused `rejected` before anything is sent, as the
 * live twin refuses it, whatever case is picked. A refusal throws exactly the live refusal (`providerRefusal` proving `not_sent`); a rate
 * limit, an outage and a lost answer throw the live failures (`meta-publishing-sandbox.failures.ts`: the same `MetaPublishingError`
 * through the live mapping). `FACEBOOK-10` makes the post and loses the answer. Post ids run `<page id>_<n>` by the calls the account
 * took (`state.seq`). The sandbox adds no idempotency: a second call posts again.
 */
export class MetaFacebookSandboxPublishService implements FacebookPublishPort {
    /** The provider key. */
    readonly provider: string = PROVIDER.meta

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** Publishes one post to the Page of a sandbox account through exactly one sandbox call keyed by the message (else the link). */
    async publish(connection: ConnectionRecord, request: FacebookPostRequest): Promise<FacebookPostResult> {
        const { message, link, media } = request
        return await this.sandbox.call(connection, FACEBOOK_PUBLISH_OPERATION, request, {
            key: message ?? link ?? "",
            answer: async (state) => {
                if (message === null && link === null && media === null) {
                    throw withProof(providerRefusal(this.provider, "rejected", "message, link or media"), "not_sent")
                }
                const refused = state.nextCase === null ? undefined : FACEBOOK_SANDBOX_REFUSALS[state.nextCase]
                if (refused !== undefined) throw withProof(providerRefusal(this.provider, refused.reason, refused.detail), "not_sent")
                if (state.nextCase === FACEBOOK_CASE.rateLimited) throw metaPublishingRateLimited()
                if (state.nextCase === FACEBOOK_CASE.serverError) throw metaPublishingServerError()
                if (state.nextCase === FACEBOOK_CASE.timeout) throw metaPublishingUnreachable()
                const result = receiptOf(request, state.seq)
                if (state.nextCase === FACEBOOK_CASE.appliedNoAnswer) {
                    await state.write(POST, result.postId ?? result.mediaId ?? "", { kind: result.kind, message })
                    throw metaPublishingUnreachable()
                }
                return result
            },
        })
    }
}
