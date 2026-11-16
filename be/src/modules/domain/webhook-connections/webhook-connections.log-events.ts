/** Log events of the webhook-connections capability. */
export enum WebhookConnectionsLogEvent {
    /** A delivery was dropped: the connection is gone or switched off, or signing is off. */
    DeliveryDropped = "webhook_connections.delivery_dropped",
    /** The stored address of a connection could not be read. */
    AddressUnreadable = "webhook_connections.address_unreadable",
}
