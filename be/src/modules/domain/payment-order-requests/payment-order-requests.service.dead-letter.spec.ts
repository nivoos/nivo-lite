import { Test } from "@nestjs/testing"
import { mock, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { evaluatedValues } from "@tests/fixtures/builders/evaluated-calls.builder"
import { buildChainRunner, deliveryOf } from "@tests/fixtures/builders/job-chain-runner.builder"
import { PAYABLE, REQUEST, entityOf } from "@tests/fixtures/builders/payment-order-requests.builder"
import { BillingError, BillingErrorCode, BillingService } from "@modules/domain/billing"
import { CreditsService } from "@modules/domain/credits"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import type { QueueDelivery } from "@modules/platform/queue"
import { CREATE_PAYMENT_ORDER_JOB, PAYMENT_ORDER_REQUEST_QUEUE, type OrderRequestPayload } from "@modules/queues/payment-order-request"
import { PaymentOrderRequestsErrorCode } from "./errors/payment-order-requests.error"
import { PaymentOrderRequestsService } from "./payment-order-requests.service"
import { PaymentOrderRequestEntity } from "./persistence/entities"

/** The runner reads the workspace of a payload only when it is a uuid. */
const WS = "11111111-1111-4111-8111-111111111111"
const PAYLOAD: OrderRequestPayload = { requestId: "request-1", workspaceId: WS }

/** The processor of the job as the feature composes it: one domain method; the dead letter writes the request's state. */
class PlaceOrderProcessor extends FencedProcessor {
    override readonly queue = PAYMENT_ORDER_REQUEST_QUEUE
    override readonly definition: JobDefinition<OrderRequestPayload> = CREATE_PAYMENT_ORDER_JOB
    constructor(private readonly requests: PaymentOrderRequestsService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.requests.answer(job)
    }
    override async onFailed(delivery: QueueDelivery, cause: unknown): Promise<void> {
        await this.requests.fail(delivery.payload, cause)
    }
}

/** The request table as the answers the service wrote to it: the last answer is the row's state. */
const build = async () => {
    const em = mockEntityManager({ update: [PaymentOrderRequestEntity, { affected: 1 }] })
    const state = (): { readonly status: "pending" | "done" | "failed"; readonly fault: string | null; readonly orderId: string | null } => {
        const changes = evaluatedValues(em.update.mock.calls.at(-1)?.[2])
        return {
            status: changes.status === "done" || changes.status === "failed" ? changes.status : "pending",
            fault: typeof changes.fault === "string" ? changes.fault : null,
            orderId: typeof changes.orderId === "string" ? changes.orderId : null,
        }
    }
    em.findOne.mockImplementation(() => Promise.resolve(entityOf({ ...REQUEST, status: state().status })))
    const billing = mock<BillingService>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            PaymentOrderRequestsService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: BillingService, useValue: billing },
            { provide: CreditsService, useValue: mock<CreditsService>() },
            { provide: QUEUE_OUTBOX, useValue: recordingQueueOutbox() },
        ],
    }).compile()
    return { billing, state, processor: new PlaceOrderProcessor(moduleRef.get(PaymentOrderRequestsService)) }
}

describe("payment order request chain: a failure that no retry can fix ends as ONE dead letter, and a resume finishes", () => {
    it("parks at once with one item, shows the refusal on the request, and the resume makes the order", async () => {
        const t = await build()
        const run = await buildChainRunner()
        run.claimed(PAYLOAD)
        t.billing.orderPlan.mockRejectedValue(new BillingError({ code: BillingErrorCode.Forbidden }))

        // First delivery: the manager's right is gone. A refusal of the domain is input: no retry is spent, the job parks.
        await run.runner.run(t.processor, deliveryOf(PAYMENT_ORDER_REQUEST_QUEUE, CREATE_PAYMENT_ORDER_JOB.name, PAYLOAD, 1))

        expect(t.billing.orderPlan).toHaveBeenCalledTimes(1)
        expect(run.claims.fail).not.toHaveBeenCalled()
        expect(run.claims.complete).not.toHaveBeenCalled()
        expect(run.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: BillingErrorCode.Forbidden }))
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(run.deadLetters.raise).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "flow-parked", jobId: "job-1", workspaceId: WS, failureClass: "input", episode: 0 }),
        )
        // The request row says why, with the stable code, and can be opened again.
        expect(t.state()).toMatchObject({ status: "failed", fault: BillingErrorCode.Forbidden })

        // The cause is fixed; a person resumes: the same job runs again (resumeCount 1) and the request is answered.
        t.billing.orderPlan.mockResolvedValue(PAYABLE)
        run.claimed(PAYLOAD, 1)
        await run.runner.run(t.processor, deliveryOf(PAYMENT_ORDER_REQUEST_QUEUE, CREATE_PAYMENT_ORDER_JOB.name, PAYLOAD, 1))

        expect(t.billing.orderPlan).toHaveBeenCalledTimes(2)
        expect(run.claims.complete).toHaveBeenCalledTimes(1)
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.state()).toEqual({ status: "done", fault: null, orderId: "order-1" })
    })

    it("retries a transient failure on the waited ladder with its pause and parks only on the last start (one item, generic fault)", async () => {
        const t = await build()
        const run = await buildChainRunner()
        run.claimed(PAYLOAD)
        t.billing.orderPlan.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))
        const deliver = (attempt: number) =>
            run.runner.run(t.processor, deliveryOf(PAYMENT_ORDER_REQUEST_QUEUE, CREATE_PAYMENT_ORDER_JOB.name, PAYLOAD, attempt))

        // Starts 1..4: a retry after 60, 120, 240, 480 seconds (the waited ladder); nothing parks, the request stays pending.
        for (const attempt of [1, 2, 3, 4]) {
            await expect(deliver(attempt)).rejects.toMatchObject({ params: { seconds: [60, 120, 240, 480][attempt - 1] } })
        }
        expect(run.claims.park).not.toHaveBeenCalled()
        expect(t.state().status).toBe("pending")

        // Start 5: the ladder is spent: ONE dead letter, the request says the job failed.
        await deliver(5)

        expect(run.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.state()).toMatchObject({ status: "failed", fault: PaymentOrderRequestsErrorCode.JobFailed })
    })
})
