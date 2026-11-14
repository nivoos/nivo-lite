import { Query } from "@nestjs/cqrs"
import type { ExecuteParams } from "@modules/platform/cqrs"
import type { ListStoppedEventsRequest, ListStoppedEventsResult } from "./list-stopped-events.contracts"

/** Asks for the buried events of a workspace the authenticated caller owns. */
export class ListStoppedEventsQuery extends Query<ListStoppedEventsResult> {
    constructor(readonly params: ExecuteParams<ListStoppedEventsRequest>) {
        super()
    }
}
