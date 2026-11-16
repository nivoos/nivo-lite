import { Injectable } from "@nestjs/common"
import { PaymentOrderRequestsService } from "@modules/domain/payment-order-requests"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { CREATE_PAYMENT_ORDER_JOB, PAYMENT_ORDER_REQUEST_QUEUE, type OrderRequestPayload } from "@modules/queues/payment-order-request"
import { PlaceOrderStep } from "../../steps/place-order.step"

@Injectable()
/** The processor of the create-payment-order job: the runner claims and settles it; `process` delegates the fenced claim to the one step. */
export class CreatePaymentOrderProcessor extends FencedProcessor {
    override readonly queue: "payment_order_requested" = PAYMENT_ORDER_REQUEST_QUEUE
    override readonly definition: JobDefinition<OrderRequestPayload> = CREATE_PAYMENT_ORDER_JOB

    constructor(
        private readonly placeOrder: PlaceOrderStep,
        private readonly requests: PaymentOrderRequestsService,
    ) {
        super()
    }

    /** Makes the order (one domain method); a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.placeOrder.run(job)
    }

    /** The job was dead-lettered (one item for a person): the request shows `failed` with its stable code; a resume of the job makes the order. */
    override onFailed(delivery: QueueDelivery, cause: unknown): Promise<void> {
        return this.requests.fail(delivery.payload, cause)
    }
}
