import { Injectable } from "@nestjs/common"
import { PublicApiProcessingService, PublicMessageDeliveryService } from "@modules/domain/public-api"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import {
    PROCESS_PUBLIC_REQUEST_JOB,
    PUBLIC_API_QUEUE,
    SEND_PUBLIC_MESSAGE_JOB,
    type PublicApiRequestPayload,
    type PublicMessageSendPayload,
} from "@modules/queues/public-api"
import { ProcessPublicApiStep } from "../../steps/process-public-api.step"
import { SendPublicMessageStep } from "../../steps/send-public-message.step"

@Injectable()
/** Runs public API requests with the standard claim, retry and dead-letter lifecycle. */
export class PublicApiRequestProcessor extends FencedProcessor {
    override readonly queue: "public_api" = PUBLIC_API_QUEUE
    override readonly definition: JobDefinition<PublicApiRequestPayload> = PROCESS_PUBLIC_REQUEST_JOB
    /** Each fulfillment holds a database connection until its domain transaction commits. */
    override readonly concurrency = 1

    constructor(
        private readonly step: ProcessPublicApiStep,
        private readonly processing: PublicApiProcessingService,
    ) {
        super()
    }

    /** Routes the supported request formats through the fenced fulfillment step. */
    async process(job: ClaimedJob): Promise<void> {
        await this.step.run(job)
    }

    /** Leaves an exhausted request visible while the transport archives the original delivery. */
    override async onFailed(delivery: QueueDelivery, _cause: unknown): Promise<void> {
        await this.processing.failDelivery(delivery)
    }
}

@Injectable()
/** Retains the original implicit job name while using the same fenced fulfillment and retry lifecycle. */
export class LegacyPublicApiRequestProcessor extends FencedProcessor {
    override readonly queue: "public_api" = PUBLIC_API_QUEUE
    override readonly job: "public_api" = PUBLIC_API_QUEUE
    /** Keeps historical deliveries within the same single-connection fulfillment budget. */
    override readonly concurrency = 1

    constructor(
        private readonly step: ProcessPublicApiStep,
        private readonly processing: PublicApiProcessingService,
    ) {
        super()
    }

    /** Routes historical deliveries through the same fenced fulfillment step. */
    async process(job: ClaimedJob): Promise<void> {
        await this.step.run(job)
    }

    /** Preserves terminal failure evidence for an exhausted historical delivery. */
    override async onFailed(delivery: QueueDelivery, _cause: unknown): Promise<void> {
        await this.processing.failDelivery(delivery)
    }
}

@Injectable()
/** Sends the reply an accepted API message owes, as the job the request's transaction wrote; the runner claims and settles it. */
export class SendPublicMessageProcessor extends FencedProcessor {
    override readonly queue: "public_api" = PUBLIC_API_QUEUE
    override readonly definition: JobDefinition<PublicMessageSendPayload> = SEND_PUBLIC_MESSAGE_JOB

    constructor(
        private readonly step: SendPublicMessageStep,
        private readonly deliveries: PublicMessageDeliveryService,
    ) {
        super()
    }

    /** Sends the reply through the delivery ledger; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.step.run(job)
    }

    /** The send was dead-lettered (one item for a person): the evidence log says the reply did not go out; a resume sends it again. */
    override async onFailed(delivery: QueueDelivery, cause: unknown): Promise<void> {
        await this.deliveries.sendStopped(delivery.payload, cause)
    }
}
