import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the payment-orders capability. */
export enum PaymentOrdersErrorCode {
    /** The insert of an order answered no row and no order of its request exists. */
    NotCreated = "PAYMENT_ORDERS_NOT_CREATED",
}

/** How each payment-orders code travels. */
export const PAYMENT_ORDERS_ERROR_KINDS: Record<PaymentOrdersErrorCode, ErrorKind> = {
    [PaymentOrdersErrorCode.NotCreated]: "internal",
}

/** The one error class of the payment-orders capability. */
export class PaymentOrdersError extends DomainError<PaymentOrdersErrorCode> {}
