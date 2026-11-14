import { Command } from "@nestjs/cqrs"
import type { ExecuteParams } from "@modules/platform/cqrs"
import type { CloseStoppedWorkRequest } from "./close-stopped-work.contracts"

/** Asks to close a stopped job of a workspace the authenticated caller owns for good; answers whether it was closed. */
export class CloseStoppedWorkCommand extends Command<boolean> {
    constructor(readonly params: ExecuteParams<CloseStoppedWorkRequest>) {
        super()
    }
}
