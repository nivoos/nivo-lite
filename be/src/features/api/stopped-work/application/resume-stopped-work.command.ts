import { Command } from "@nestjs/cqrs"
import type { ExecuteParams } from "@modules/platform/cqrs"
import type { ResumeStoppedWorkRequest } from "./resume-stopped-work.contracts"

/** Asks to hand a stopped job of a workspace the authenticated caller owns back to its queue; answers whether it went back. */
export class ResumeStoppedWorkCommand extends Command<boolean> {
    constructor(readonly params: ExecuteParams<ResumeStoppedWorkRequest>) {
        super()
    }
}
