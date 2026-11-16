import { Command } from "@nestjs/cqrs"
import type { PublicExecuteParams } from "@modules/platform/cqrs"
import type { StartConnectionPollRequest } from "./start-connection-poll.contracts"

/** Asks the one poll job to read a connection that just became ready; answers whether its provider has a poll receiver. */
export class StartConnectionPollCommand extends Command<boolean> {
    constructor(readonly params: PublicExecuteParams<StartConnectionPollRequest>) {
        super()
    }
}
