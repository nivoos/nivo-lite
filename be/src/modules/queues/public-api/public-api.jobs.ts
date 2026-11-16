import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import {
    PublicApiQueueJob,
    isPublicApiRequestPayload,
    isPublicMessageSendPayload,
    publicApiDedupeKey,
    publicMessageSendKey,
    type PublicApiRequestPayload,
    type PublicMessageSendPayload,
} from "./public-api.contracts"
import { PUBLIC_API_QUEUE } from "./public-api.queue"

/**
 * The job that carries out one request the public API accepted (a knowledge source, or a message whose reply is owed). The caller is a
 * program that polls nothing a person watches, so it is `background`. Its inbox claim, its domain writes, the completion of the ledger row
 * and the send job of a reply are one transaction held under the job's fence: the send is enqueued there, never kept in memory. The
 * once key is the dedupe key the producer always wrote.
 */
export const PROCESS_PUBLIC_REQUEST_JOB: JobDefinition<PublicApiRequestPayload> = defineJob<PublicApiRequestPayload>({
    name: PublicApiQueueJob.Request,
    queue: PUBLIC_API_QUEUE,
    ladder: "background",
    payload: isPublicApiRequestPayload,
    onceKey: (payload) => publicApiDedupeKey(payload.requestId),
    next: [PublicApiQueueJob.Send],
    effects: [],
})

/**
 * The job that sends the reply of an accepted API message to the person's channel. The reply goes out through the engine's delivery
 * ledger, which is the intent-before-act ledger of every customer send (the send key is claimed before the provider is asked and
 * settled after; an outcome it cannot settle is a dead letter a person decides, and the person's resume sends again). Nobody watches
 * it, so it is `background`.
 */
export const SEND_PUBLIC_MESSAGE_JOB: JobDefinition<PublicMessageSendPayload> = defineJob<PublicMessageSendPayload>({
    name: PublicApiQueueJob.Send,
    queue: PUBLIC_API_QUEUE,
    ladder: "background",
    payload: isPublicMessageSendPayload,
    onceKey: (payload) => publicMessageSendKey(payload.sendKey),
    next: [],
    effects: [],
})
