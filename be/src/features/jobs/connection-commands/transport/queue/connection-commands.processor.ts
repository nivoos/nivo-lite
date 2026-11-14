import { Injectable } from "@nestjs/common"
import { ConnectionCommandsService } from "@modules/domain/connection-commands"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import {
    CONNECTION_COMMANDS_QUEUE,
    RUN_CONNECTION_COMMAND_JOB,
    type ConnectionCommandPayload,
} from "@modules/queues/connection-commands"
import { RunCommandStep } from "../../steps/run-command.step"

@Injectable()
/**
 * The processor of the connection-commands job: the runner claims and settles it; `process` delegates the fenced claim to the one step. A
 * refusal the input earned is written to the command's row by the domain; every other failure throws for the runner.
 */
export class ConnectionCommandsProcessor extends FencedProcessor {
    override readonly queue: "connection_commands" = CONNECTION_COMMANDS_QUEUE
    override readonly definition: JobDefinition<ConnectionCommandPayload> = RUN_CONNECTION_COMMAND_JOB

    constructor(
        private readonly runCommand: RunCommandStep,
        private readonly commands: ConnectionCommandsService,
    ) {
        super()
    }

    /** Runs the command; a stale token throws the fenced-out error from the guarded write before the effect and nothing else happens. */
    async process(job: ClaimedJob): Promise<void> {
        await this.runCommand.run(job)
    }

    /** At the dead letter the command's row reads failed so the screen stops waiting; a resume runs the command again. */
    override async onFailed(delivery: QueueDelivery, _cause: unknown): Promise<void> {
        await this.commands.stopped(delivery.payload)
    }
}
