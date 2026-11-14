import { Test } from "@nestjs/testing"
import { mock, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { PAYABLE, REQUEST, entityOf } from "@tests/fixtures/builders/payment-order-requests.builder"
import { BillingService } from "@modules/domain/billing"
import type { PayableOrder } from "@modules/domain/billing"
import { CreditsService } from "@modules/domain/credits"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import type { ClaimedJob } from "@modules/platform/jobs"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { PaymentOrderRequestsService } from "./payment-order-requests.service"
import { PaymentOrderRequestEntity } from "./persistence/entities"

const JOB: ClaimedJob = {
    jobId: "job-1",
    kind: "payment_order_requested",
    fencingToken: 1,
    currentStep: "place",
    payload: { requestId: "request-1", workspaceId: "ws-1" },
}

/** The process "dies" here: the error a write throws when its worker is gone. */
const killed = (): Error => Object.assign(new Error("worker killed"), { code: "ECONNRESET" })

/**
 * The orders table as far as this chain depends on it: one order per request id (the unique key `payment_orders.request_id`), so a
 * second `create` for the same request writes nothing and answers the order the first one made.
 */
const ordersTable = () => {
    const byRequest = new Map<string, PayableOrder>()
    return {
        written: (): number => byRequest.size,
        create: (requestId: string | undefined): PayableOrder => {
            const key = requestId ?? "none"
            const made = byRequest.get(key) ?? { ...PAYABLE, order: { ...PAYABLE.order, id: `order-of-${key}` } }
            byRequest.set(key, made)
            return made
        },
    }
}

describe("payment order request chain: the job is run twice, the second run repeats no finished step", () => {
    it("a kill between the order and the answer of the request makes ONE order and answers the request on the second run", async () => {
        const table = ordersTable()
        const em: MockEntityManager = mockEntityManager({ findOne: [PaymentOrderRequestEntity, entityOf(REQUEST)], update: [PaymentOrderRequestEntity, { affected: 1 }] })
        const billing = mock<BillingService>()
        billing.orderPlan.mockImplementation((_user, params) => Promise.resolve(table.create(params.requestId)))
        const moduleRef = await Test.createTestingModule({
            providers: [
                PaymentOrderRequestsService,
                { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
                { provide: BillingService, useValue: billing },
                { provide: CreditsService, useValue: mock<CreditsService>() },
                { provide: QUEUE_OUTBOX, useValue: recordingQueueOutbox() },
            ],
        }).compile()
        const requests = moduleRef.get(PaymentOrderRequestsService)
        // The worker dies after the order was written and before the request row could be answered.
        em.update.mockRejectedValueOnce(killed())

        await expect(requests.answer(JOB)).rejects.toMatchObject({ code: "ECONNRESET" })

        expect(table.written()).toBe(1)
        expect(em.update).toHaveBeenCalledTimes(1)

        // The next delivery runs the job again: the request is still pending, the order is not made a second time, the request is answered.
        await expect(requests.answer(JOB)).resolves.toBe("ordered")

        expect(billing.orderPlan).toHaveBeenCalledTimes(2)
        expect(billing.orderPlan.mock.calls.map(([, params]) => params.requestId)).toEqual(["request-1", "request-1"])
        expect(table.written()).toBe(1)
        expect(em.update).toHaveBeenCalledTimes(2)
        expect(em.update.mock.calls[1]?.[2]).toMatchObject({ status: "done", orderId: "order-of-request-1" })
    })

    it("a renewal killed the same way makes ONE order (the key rides on every order path)", async () => {
        const table = ordersTable()
        const em: MockEntityManager = mockEntityManager({ findOne: [PaymentOrderRequestEntity, entityOf({ ...REQUEST, kind: "renew", target: null })], update: [PaymentOrderRequestEntity, { affected: 1 }] })
        const billing = mock<BillingService>()
        billing.renew.mockImplementation((_user, params) => Promise.resolve(table.create(params.requestId)))
        const moduleRef = await Test.createTestingModule({
            providers: [
                PaymentOrderRequestsService,
                { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
                { provide: BillingService, useValue: billing },
                { provide: CreditsService, useValue: mock<CreditsService>() },
                { provide: QUEUE_OUTBOX, useValue: recordingQueueOutbox() },
            ],
        }).compile()
        const requests = moduleRef.get(PaymentOrderRequestsService)
        em.update.mockRejectedValueOnce(killed())

        await expect(requests.answer(JOB)).rejects.toMatchObject({ code: "ECONNRESET" })
        await expect(requests.answer(JOB)).resolves.toBe("ordered")

        expect(table.written()).toBe(1)
    })
})
