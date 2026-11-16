import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import {
    WORKFLOW_START_QUEUE,
    WorkflowStartJob,
    isWorkflowStartPayload,
    type WorkflowStartPayload,
} from "./workflow-start.contracts"

/**
 * The delivery of a person's start of a workflow to the one event pipeline: the person pressed a button and waits, so it is `waited`. The
 * once key is the start's own key (the person and their opKey), so a start written twice is one job and one event. A start the workflow
 * no longer takes (paused or replaced between the press and the delivery) THROWS (class input): the job parks with ONE item for the
 * founder and nothing is claimed, so after the workflow runs again a resume delivers the start.
 */
export const DELIVER_WORKFLOW_START_JOB: JobDefinition<WorkflowStartPayload> = defineJob<WorkflowStartPayload>({
    name: WorkflowStartJob.Deliver,
    queue: WORKFLOW_START_QUEUE,
    ladder: "waited",
    payload: isWorkflowStartPayload,
    onceKey: (payload) => payload.key,
    next: [],
    effects: [],
})
