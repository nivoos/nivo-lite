/** The durable queue of the deferred telegram receipt consumer. */
export const TELEGRAM_DELIVERY_QUEUE = "telegram-delivery"
/** The durable receipt event consumed after the HTTP transaction commits. */
export interface TelegramDeliveryRecorded {
    /** The original provider delivery key. */
    readonly deliveryId: string
}

/** Validates a committed receipt reference before the worker resolves its payload. */
export const isTelegramDeliveryRecorded = (value: unknown): value is TelegramDeliveryRecorded =>
    typeof value === "object" &&
    value !== null &&
    "deliveryId" in value &&
    typeof value.deliveryId === "string" &&
    value.deliveryId.trim().length > 0
