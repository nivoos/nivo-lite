import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { RECORD_EVENTS_QUEUE, RecordEventsJob, isRecordEventPayload, recordEventIdOf, type RecordEventPayload } from "./record-events.contracts"

/**
 * The job that hands one record write to the one event pipeline (concept agent-data rule 2): the entity engine writes it as a queue OUTBOX
 * row in the SAME transaction as the write, so a write that commits is always delivered and one that rolls back never is. Nobody waits on
 * the delivery: `background` ladder; a delivery that fails for good parks with one item for a person. The once key is the write's own
 * (`<type>:<id>:v<version>`) and the pipeline keeps the event id once, so a redelivery wakes nobody twice.
 */
export const DELIVER_RECORD_EVENT_JOB: JobDefinition<RecordEventPayload> = defineJob<RecordEventPayload>({
    name: RecordEventsJob.Deliver,
    queue: RECORD_EVENTS_QUEUE,
    ladder: "background",
    payload: isRecordEventPayload,
    onceKey: (payload) => `record-event:${recordEventIdOf(payload)}`,
    next: [],
    effects: [],
})
