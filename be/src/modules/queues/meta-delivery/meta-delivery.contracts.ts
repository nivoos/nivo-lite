/** The durable queue of the deferred meta receipt consumer. */
export const META_DELIVERY_QUEUE = "meta-delivery"
/** The durable receipt reference consumed after intake commits. */
export interface MetaDeliveryRecorded {
    /** The original provider delivery key. */
    readonly deliveryId: string
}

/** Validates a committed receipt reference before the worker resolves its payload. */
export const isMetaDeliveryRecorded = (value: unknown): value is MetaDeliveryRecorded =>
    typeof value === "object" &&
    value !== null &&
    "deliveryId" in value &&
    typeof value.deliveryId === "string" &&
    value.deliveryId.trim().length > 0
