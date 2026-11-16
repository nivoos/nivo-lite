import { Command } from "@nestjs/cqrs"
import type { ExecuteParams } from "@modules/platform/cqrs"
import type { OwnerPauseAnswer } from "@modules/domain/agent-runs"
import type { ResumeAgentRunRequest } from "./resume-agent-run.contracts"

/** Resumes a run a person paused: the wakes held while it was paused run in the order they came. */
export class ResumeAgentRunCommand extends Command<OwnerPauseAnswer> {
    constructor(readonly params: ExecuteParams<ResumeAgentRunRequest>) {
        super()
    }
}
