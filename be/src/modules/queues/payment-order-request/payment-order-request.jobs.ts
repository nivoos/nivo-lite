import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { PAYMENT_ORDER_REQUEST_QUEUE } from "./payment-order-request.queue"
import { isOrderRequestPayload, orderRequestDedupeKey, type OrderRequestPayload } from "./payment-order-request.contracts"

/**
 * The job that makes the payment order a member asked for and answers the request row. The member watches the screen for the QR, so it
 * is on the `waited` ladder. It ends nothing else (`next` is empty) and acts nowhere outside the database (the QR image is a link built
 * from the order), so it declares no effect. The job keeps the name of its queue, as it always had; the once key is the request id.
 */
export const CREATE_PAYMENT_ORDER_JOB: JobDefinition<OrderRequestPayload> = defineJob<OrderRequestPayload>({
    name: PAYMENT_ORDER_REQUEST_QUEUE,
    queue: PAYMENT_ORDER_REQUEST_QUEUE,
    ladder: "waited",
    payload: isOrderRequestPayload,
    onceKey: orderRequestDedupeKey,
    next: [],
    effects: [],
})
