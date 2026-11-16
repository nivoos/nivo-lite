import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { WEBSITE_FORM_QUEUE, WebsiteFormJob, isWebsiteFormPayload, websiteFormKeyOf, type WebsiteFormPayload } from "./website-form.contracts"

/**
 * The job that hands one stored website submission to the owning agent through the one event pipeline: it meets the visitor's core
 * contact (idempotent), links the claims, and delivers the form's event. The door writes it as a queue outbox row in the SAME transaction
 * that stores the submission, so a process that dies between the store and the wake loses nothing: the broker redelivers it, a failure
 * runs the ladder, and a delivery that fails for good parks with one item for a person. The visitor was already answered, nobody waits on
 * the result: `background` ladder. The once key is one per stored input, and the pipeline keeps the event id once, so a redelivery wakes
 * nobody twice.
 */
export const DELIVER_WEBSITE_FORM_JOB: JobDefinition<WebsiteFormPayload> = defineJob<WebsiteFormPayload>({
    name: WebsiteFormJob.Deliver,
    queue: WEBSITE_FORM_QUEUE,
    ladder: "background",
    payload: isWebsiteFormPayload,
    onceKey: (payload) => websiteFormKeyOf(payload.inboundEventId),
    next: [],
    effects: [],
})
