import { Injectable } from "@nestjs/common"
import { ZaloCredentialsService } from "@modules/domain/channels"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import {
    COMPLETE_ZALO_AUTHORIZATION_JOB,
    ZALO_AUTHORIZATION_QUEUE,
    type ZaloAuthorizationPayload,
} from "@modules/queues/zalo-authorization"
import { CompleteAuthorizationStep } from "../../steps/complete-authorization.step"

@Injectable()
/**
 * The processor of the complete-zalo-authorization job: the runner claims and settles it; `process` delegates the fenced claim to the one
 * step. A failure throws (the one-time code is exchanged once: the answer is kept before it is stored): the runner retries a transient one
 * on the `waited` ladder and parks the rest with one item.
 */
export class CompleteZaloAuthorizationProcessor extends FencedProcessor {
    override readonly queue: "zalo_authorization" = ZALO_AUTHORIZATION_QUEUE
    override readonly definition: JobDefinition<ZaloAuthorizationPayload> = COMPLETE_ZALO_AUTHORIZATION_JOB

    constructor(
        private readonly complete: CompleteAuthorizationStep,
        private readonly credentials: ZaloCredentialsService,
    ) {
        super()
    }

    /** Completes the authorization; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.complete.run(job)
    }

    /** At the dead letter the connection reads failing for its owner; a resume runs the job again and completes it. */
    override async onFailed(delivery: QueueDelivery, _cause: unknown): Promise<void> {
        await this.credentials.authorizationFailed(delivery.payload)
    }
}
