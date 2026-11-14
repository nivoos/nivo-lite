import { Query } from "@nestjs/cqrs"
import type { ExecuteParams } from "@modules/platform/cqrs"
import type { ListStoppedWorkRequest, ListStoppedWorkResult } from "./list-stopped-work.contracts"

/** Asks for the stopped jobs of a workspace the authenticated caller owns. */
export class ListStoppedWorkQuery extends Query<ListStoppedWorkResult> {
    constructor(readonly params: ExecuteParams<ListStoppedWorkRequest>) {
        super()
    }
}
