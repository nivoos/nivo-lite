import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { META_INBOUND_JOB, META_INBOUND_QUEUE, type MetaInboundPayload } from "@modules/queues/meta-inbound"
import { DeliverEventStep } from "../../steps/deliver-event.step"

@Injectable()
/** The processor of the accept-meta-event job: the runner claims and settles it; `process` delegates the fenced claim to the one step. */
export class AcceptMetaEventProcessor extends FencedProcessor {
    override readonly queue: "meta_inbound" = META_INBOUND_QUEUE
    override readonly definition: JobDefinition<MetaInboundPayload> = META_INBOUND_JOB

    constructor(private readonly deliverEvent: DeliverEventStep) {
        super()
    }

    /** Delivers the event; a failure throws (the runner retries it on its ladder, then one dead letter); a stale token throws the fenced-out error before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.deliverEvent.run(job)
    }
}
