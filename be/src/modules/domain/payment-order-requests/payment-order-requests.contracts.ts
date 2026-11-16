/** What a member asked to pay. */
export type PaymentOrderRequestKind = "plan" | "renew" | "topup" | "upgrade" | "credit_pack"

/** An authenticated manager's request to create a payment order. */
export interface PaymentOrderRequestParams {
    /** The workspace that pays. */
    readonly workspaceId: string
    /** The order operation to enqueue. */
    readonly kind: PaymentOrderRequestKind
    /** The active plan or pack code; absent for a renewal. */
    readonly target?: string | null | undefined
    /** Pay month by month or a year at once; a plan order only, monthly when absent. */
    readonly cycle?: "monthly" | "annual" | null | undefined
    /** The monthly allowance picked from the plan's usage tiers (per seat on Team); a plan order only. */
    readonly tierCredits?: number | null | undefined
    /** The seats of a per-seat plan; a plan order only. */
    readonly seats?: number | null | undefined
}

/** The cycle, usage tier and seats a plan request carries, bounded. */
export interface RequestSelection {
    /** The billing cycle, or null for a request that is not a plan order. */
    readonly cycle: "monthly" | "annual" | null
    /** The usage tier, or null. */
    readonly tierCredits: number | null
    /** The seats, or null. */
    readonly seats: number | null
}

/** The immediate answer after the request and its job commit together. */
export interface QueuedPaymentOrderRequest {
    /** The request id to poll. */
    readonly id: string
    /** Work has been accepted by the queue. */
    readonly status: "queued"
}

/** The requester's view of a payment-order job. */
export interface PaymentOrderRequestStatus {
    /** The request id. */
    readonly id: string
    /** The job's current progress or terminal outcome. */
    readonly status: "queued" | "succeeded" | "failed"
    /** The created payment order, once successful. */
    readonly resultId: string | null
    /** The stable domain refusal code, once failed. */
    readonly errorCode: string | null
}

/** The request status when visible to the caller, or null when absent. */
export type PaymentOrderRequestStatusLookup = PaymentOrderRequestStatus | null

/** What happened to a request: its order was made and the request answered, or there was nothing to do (gone, or already answered). A refusal is thrown, never an outcome. */
export type RequestOutcome = "ordered" | "ignored"
