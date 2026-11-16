import { Query } from "@nestjs/cqrs"
import type { RunView } from "@modules/domain/agent-runs"
import type { ExecuteParams } from "@modules/platform/cqrs"

/** What agentRunsInFlight takes. */
export interface RunsInFlightRequest {
    /** The workspace the request is made in. */
    readonly workspaceId: string
    /** The customer conversation (the route). */
    readonly conversationId: string
    /** Its person, when the caller knows it. */
    readonly contactId: string | null
}

/** Reads the runs in flight that serve one customer conversation. */
export class RunsInFlightQuery extends Query<ReadonlyArray<RunView>> {
    constructor(readonly params: ExecuteParams<RunsInFlightRequest>) {
        super()
    }
}
