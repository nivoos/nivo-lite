import { Command } from "@nestjs/cqrs"
import type { ExecuteParams } from "@modules/platform/cqrs"
import type { RequeueStoppedEventRequest } from "./requeue-stopped-event.contracts"

/** Asks to send a buried event of a workspace the authenticated caller owns back to its consumer; answers whether it went back. */
export class RequeueStoppedEventCommand extends Command<boolean> {
    constructor(readonly params: ExecuteParams<RequeueStoppedEventRequest>) {
        super()
    }
}
