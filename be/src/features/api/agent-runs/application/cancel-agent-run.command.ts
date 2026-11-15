import { Command } from "@nestjs/cqrs"
import type { ExecuteParams } from "@modules/platform/cqrs"
import type { OwnerEndAnswer, OwnerPauseAnswer, WorkflowRunsEnded } from "@modules/domain/agent-runs"
import type { CancelAgentRunRequest, EndWorkflowRunsRequest, RunPauseRequest } from "./cancel-agent-run.contracts"

/** Ends a run in flight, whatever its state; what its steps already sent is not undone. */
export class CancelAgentRunCommand extends Command<OwnerEndAnswer> {
    constructor(readonly params: ExecuteParams<CancelAgentRunRequest>) {
        super()
    }
}

/** Pauses a run in flight: no further step and no wake until a person resumes it. */
export class PauseAgentRunCommand extends Command<OwnerPauseAnswer> {
    constructor(readonly params: ExecuteParams<RunPauseRequest>) {
        super()
    }
}

/** Ends every run of a workflow in flight, one by one through the run door. */
export class EndWorkflowRunsCommand extends Command<WorkflowRunsEnded> {
    constructor(readonly params: ExecuteParams<EndWorkflowRunsRequest>) {
        super()
    }
}
