/** The payload of one create-payment-order job: ids only. */
export interface OrderRequestPayload {
    /** The workspace that pays. */
    readonly workspaceId: string
    /** The request row the answer is written to. */
    readonly requestId: string
}

/** True when a job payload is the payload of a create-payment-order job. */
export const isOrderRequestPayload = (value: unknown): value is OrderRequestPayload =>
    typeof value === "object" &&
    value !== null &&
    "workspaceId" in value &&
    typeof value.workspaceId === "string" &&
    "requestId" in value &&
    typeof value.requestId === "string"

/** The identity of the one job of a request: the request id (the same key written twice is one job). */
export const orderRequestDedupeKey = (payload: OrderRequestPayload): string => `payment-order-request:${payload.requestId}`
