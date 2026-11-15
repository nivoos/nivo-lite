import { Injectable } from "@nestjs/common"
import { In, type EntityManager } from "typeorm"
import { BillingService } from "@modules/domain/billing"
import { CreditsError, CreditsErrorCode, CreditsService } from "@modules/domain/credits"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { deadLetterCauseOf, payloadOfJob, type ClaimedJob } from "@modules/platform/jobs"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import { CREATE_PAYMENT_ORDER_JOB, isOrderRequestPayload, type OrderRequestPayload } from "@modules/queues/payment-order-request"
import {
    type PaymentOrderRequestParams,
    type PaymentOrderRequestStatusLookup,
    type QueuedPaymentOrderRequest,
    type RequestOutcome,
} from "./payment-order-requests.contracts"
import { PaymentOrderRequestsError, PaymentOrderRequestsErrorCode } from "./errors/payment-order-requests.error"
import { selectionOf, targetOf, toRequestStatus } from "./payment-order-requests.policy"
import { PaymentOrderRequestEntity } from "./persistence/entities"

@Injectable()
/**
 * Creates authorized payment order requests and answers them with database prices through the create-payment-order job.
 */
export class PaymentOrderRequestsService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        private readonly billing: BillingService,
        private readonly credits: CreditsService,
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
    ) {}

    /** Commits an authorized manager's request and its durable queue job together, then answers immediately. */
    async request(userId: string, params: PaymentOrderRequestParams): Promise<QueuedPaymentOrderRequest> {
        await this.billing.requireManager(userId, params.workspaceId)
        const target = targetOf(params)
        const selection = selectionOf(params)
        await this.requireTarget(params.kind, target)
        return this.entityManager.transaction(async (manager) => {
            const inserted = await manager.insert(PaymentOrderRequestEntity, {
                workspaceId: params.workspaceId,
                requestedBy: userId,
                kind: params.kind,
                target,
                cycle: selection.cycle,
                tierCredits: selection.tierCredits,
                seats: selection.seats,
            })
            const identifier: { id?: string } | undefined = inserted.identifiers[0]
            if (identifier?.id === undefined) {
                throw new PaymentOrderRequestsError({ code: PaymentOrderRequestsErrorCode.NotCreated })
            }
            const payload: OrderRequestPayload = { workspaceId: params.workspaceId, requestId: identifier.id }
            await this.outbox.write(manager, CREATE_PAYMENT_ORDER_JOB.queue, payload, {
                job: CREATE_PAYMENT_ORDER_JOB.name,
                dedupeKey: CREATE_PAYMENT_ORDER_JOB.onceKey(payload),
            })
            return { id: identifier.id, status: "queued" }
        })
    }

    /** Reads only this manager's own request; another caller or workspace receives no row. */
    async status(userId: string, workspaceId: string, id: string): Promise<PaymentOrderRequestStatusLookup> {
        await this.billing.requireManager(userId, workspaceId)
        const row = await this.entityManager.findOne(PaymentOrderRequestEntity, {
            select: { id: true, status: true, orderId: true, fault: true },
            where: { id, workspaceId, requestedBy: userId },
        })
        return row === null ? null : toRequestStatus(row)
    }

    /**
     * Makes the order of one request: the job's one domain method. A request that is gone or already answered is a typed end
     * (nothing to do, returned); a request the dead letter closed as failed is open again when a person resumed the job. Any refusal
     * THROWS (a domain refusal such as "not a manager" or "unknown plan" is class input, so it parks at once with one item, and the
     * request row shows its stable code); the order is made once per request whatever number of runs (the request is the order's
     * unique key), so a run killed between the order and its answer finds the order and only closes the request.
     */
    async answer(job: ClaimedJob): Promise<RequestOutcome> {
        const run = payloadOfJob(CREATE_PAYMENT_ORDER_JOB, job)
        const request = await this.entityManager.findOne(PaymentOrderRequestEntity, {
            where: { id: run.requestId, workspaceId: run.workspaceId },
        })
        if (request === null || request.status === "done") return "ignored"
        if (request.status === "failed" && (job.resumeCount ?? 0) === 0) return "ignored"
        const orderId = await this.place(request)
        await this.close(request.id, { status: "done", orderId, fault: null })
        return "ordered"
    }

    /**
     * The job was dead-lettered: the request shows `failed` with the stable code of the refusal (a domain refusal's own code), or the
     * general failure code for any other class, and a resume of the job opens it again.
     */
    async fail(payload: unknown, cause: unknown): Promise<void> {
        if (!isOrderRequestPayload(payload)) return
        const dead = deadLetterCauseOf(cause)
        const fault =
            dead !== undefined && (dead.failureClass === "input" || dead.failureClass === "config")
                ? (dead.code ?? PaymentOrderRequestsErrorCode.JobFailed)
                : PaymentOrderRequestsErrorCode.JobFailed
        await this.close(payload.requestId, { status: "failed", fault }, payload.workspaceId)
    }

    /** Answers a request that is not done yet (pending, or failed and being resumed); a done one stays as it is. */
    private async close(
        id: string,
        answer: Pick<Partial<PaymentOrderRequestEntity>, "status" | "orderId" | "fault">,
        workspaceId?: string,
    ): Promise<void> {
        await this.entityManager.update(
            PaymentOrderRequestEntity,
            { id, status: In(["pending", "failed"]), ...(workspaceId === undefined ? {} : { workspaceId }) },
            { ...answer, answeredAt: () => "now()" },
        )
    }

    private async requireTarget(kind: PaymentOrderRequestParams["kind"], target: string | null): Promise<void> {
        if (target === null || kind === "credit_pack") return
        if (kind !== "topup") {
            await this.billing.requirePlan(target)
            return
        }
        const packs = await this.credits.listPacks()
        if (!packs.some((pack) => pack.code === target)) {
            throw new CreditsError({ code: CreditsErrorCode.PackNotFound })
        }
    }

    private async place(request: PaymentOrderRequestEntity): Promise<string> {
        const requestId = request.id
        const userId = request.requestedBy
        const workspaceId = request.workspaceId
        const target = request.target ?? ""
        switch (request.kind) {
            case "plan":
                return (
                    await this.billing.orderPlan(userId, {
                        workspaceId,
                        planCode: target,
                        selection: {
                            cycle: request.cycle ?? "monthly",
                            tierCredits: request.tierCredits,
                            seats: request.seats ?? 1,
                        },
                        requestId,
                    })
                ).order.id
            case "renew":
                return (await this.billing.renew(userId, { workspaceId, requestId })).order.id
            case "topup":
                return (await this.credits.topup(userId, { workspaceId, packCode: target, requestId })).order.id
            case "credit_pack":
                return (await this.credits.creditPack(userId, { workspaceId, credits: Number(target), requestId })).order.id
            case "upgrade":
                return (await this.credits.upgrade(userId, { workspaceId, planCode: target, requestId })).payable.order.id
        }
    }
}
