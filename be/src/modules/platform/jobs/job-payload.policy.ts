import { QueueError, QueueErrorCode } from "@modules/platform/queue"
import type { ClaimedJob } from "./jobs.contracts"
import type { JobDefinition } from "./job-definition"

/**
 * The payload of a claimed job as its declaration types it. The runner already refused a payload the declaration's guard does not accept
 * (a dead letter at once, class `input`); this narrows the type for the one domain method and, for a caller that reaches it another way,
 * refuses the same way instead of ending the job silently.
 */
export const payloadOfJob = <P extends object>(definition: JobDefinition<P>, job: ClaimedJob): P => {
    const { payload } = job
    if (!definition.payload(payload)) {
        throw new QueueError({
            code: QueueErrorCode.FlowFailure,
            params: { failureClass: "input", reason: `payload refused: ${definition.name}` },
        })
    }
    return payload
}
