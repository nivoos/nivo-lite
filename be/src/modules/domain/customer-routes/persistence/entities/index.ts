import { CustomerMessageEntity } from "./customer-message.entity"
import { CustomerRouteEntity } from "./customer-route.entity"
import { StreamCursorEntity } from "./stream-cursor.entity"

export { CustomerMessageEntity, CustomerRouteEntity, StreamCursorEntity }
export type { CustomerMessageDirection, CustomerMessageFileValue } from "./customer-message.entity"

/** The entities the customer routes own, collected by the database module. */
export const customerRoutesEntities: readonly [typeof CustomerRouteEntity, typeof CustomerMessageEntity, typeof StreamCursorEntity] = [
    CustomerRouteEntity,
    CustomerMessageEntity,
    StreamCursorEntity,
] as const
