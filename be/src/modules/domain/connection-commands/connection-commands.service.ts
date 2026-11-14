import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { ChannelFrontDoorService } from "@modules/domain/agent-instances"
import { ChannelConnectionsService } from "@modules/domain/channel-connections"
import { ConnectionGrantsService } from "@modules/domain/connection-grants"
import { ConnectionLifecycleService } from "@modules/domain/connection-lifecycle"
import {
    ConnectionsError,
    ConnectionsErrorCode,
    ConnectionsService,
    type ConnectionActor,
} from "@modules/domain/connections"
import { GoogleConnectionsService } from "@modules/domain/google-connections"
import { MetaConnectionsService } from "@modules/domain/meta-connections"
import { WebhookConnectionsService } from "@modules/domain/webhook-connections"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectEffects, onceAnswered, type Effects } from "@modules/platform/effects"
import { InjectErrorsService, type ErrorsService } from "@modules/platform/errors"
import type { ClaimedJob } from "@modules/platform/jobs"
import { classifyFailure } from "@modules/platform/queue"
import { CONNECTION_COMMAND_EFFECT, isConnectionCommandPayload } from "@modules/queues/connection-commands"
import type { CommandFailed, CommandOutcome } from "./connection-commands.contracts"
import { toConnectionCommand } from "./connection-commands.mapper"
import { connectedChannelOf, reachesProvider, runCommand } from "./connection-commands.policy"
import { ConnectionCommandEntity } from "./persistence/entities"

/** True for a failure the input itself earned: the class of the platform's one classifier is `input` or `config`. */
const isRefusal = (cause: unknown): boolean => {
    const failureClass = classifyFailure(cause)
    return failureClass === "input" || failureClass === "config"
}

/** True when an outcome is the one the dead letter writes: the command stopped after its tries. */
const isStopped = (outcome: object | null): boolean =>
    outcome !== null && "ok" in outcome && outcome.ok === false && "code" in outcome && outcome.code === ConnectionsErrorCode.CommandStopped

@Injectable()
/**
 * Runs the console commands members submitted through the database: as that member, in that workspace, writing the outcome back to the row. A
 * command ends in one of three ways. Its answer is written. A refusal the input itself earned (a class `input` or `config` failure: an unknown
 * kind, a field that does not fit, a bot another workspace holds, a provider that said no) is written as the failed outcome and the job
 * returns. Anything else (the provider unreachable, a bug) is thrown: the runner tries it again on the waited ladder and parks it with one
 * item, and at the dead letter the row reads failed so the screen never waits for ever. A command that reaches a provider makes that act as
 * one effect keyed by the job.
 */
export class ConnectionCommandsService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectErrorsService() private readonly errors: ErrorsService,
        @InjectEffects() private readonly effects: Effects,
        private readonly connections: ConnectionsService,
        private readonly grants: ConnectionGrantsService,
        private readonly channels: ChannelConnectionsService,
        private readonly webhooks: WebhookConnectionsService,
        private readonly google: GoogleConnectionsService,
        private readonly meta: MetaConnectionsService,
        private readonly lifecycle: ConnectionLifecycleService,
        private readonly frontDoor: ChannelFrontDoorService,
    ) {}

    /** Runs the command a claimed job names; its payload was checked by the job's declaration, a payload that is not one is refused as invalid. */
    async runFromJob(job: ClaimedJob): Promise<void> {
        if (!isConnectionCommandPayload(job.payload)) {
            throw new ConnectionsError({ code: ConnectionsErrorCode.CommandInvalid, params: { field: "payload" } })
        }
        await this.run(job.payload.commandId, job)
    }

    /**
     * Runs one pending command and writes its outcome (the answer, or the code of the refusal) to the row; an unknown or finished command
     * changes nothing, so a redelivered job never runs a command twice.
     */
    async run(commandId: string, job: ClaimedJob): Promise<void> {
        const row = await this.entityManager.findOne(ConnectionCommandEntity, { where: { id: commandId } })
        if (row === null) return
        const command = toConnectionCommand(row)
        // A command the dead letter closed as stopped is open again when a person resumed the job: it runs again.
        const resumed = (job.resumeCount ?? 0) > 0 && isStopped(row.outcome)
        if (command.status === "done" && !resumed) return
        const outcome = await this.outcomeOf(
            command.kind,
            command.input,
            { principalId: command.userId, workspaceId: command.workspaceId },
            job,
        )
        await this.writeOutcome(command.id, outcome, resumed ? "done" : "pending")
    }

    /** The job went to its dead letter: a command still pending reads failed (the person may submit it again), and a resume runs it again. */
    async stopped(payload: unknown): Promise<void> {
        if (!isConnectionCommandPayload(payload)) return
        await this.writeOutcome(payload.commandId, {
            ok: false,
            kind: "unavailable",
            code: ConnectionsErrorCode.CommandStopped,
            params: {},
        })
    }

    private async writeOutcome(commandId: string, outcome: CommandOutcome, from: "pending" | "done" = "pending"): Promise<void> {
        await this.entityManager.update(
            ConnectionCommandEntity,
            { id: commandId, status: from },
            { status: "done", outcome, finishedAt: () => "now()" },
        )
    }

    private async outcomeOf(
        kind: string,
        input: Readonly<Record<string, unknown>>,
        actor: ConnectionActor,
        job: ClaimedJob,
    ): Promise<CommandOutcome> {
        try {
            return { ok: true, value: await this.made(kind, input, actor, job) }
        } catch (cause) {
            // A refusal the input earned is the command's answer; anything else is the runner's to judge.
            if (!isRefusal(cause)) throw cause
            return this.failed(cause)
        }
    }

    /** The command's act: through the effects port when it reaches a provider, then the front door of a customer channel it connected. */
    private made(kind: string, input: Readonly<Record<string, unknown>>, actor: ConnectionActor, job: ClaimedJob): Promise<unknown> {
        const act = async (): Promise<unknown> => {
            const value = await runCommand(
                {
                    connections: this.connections,
                    grants: this.grants,
                    channels: this.channels,
                    webhooks: this.webhooks,
                    google: this.google,
                    meta: this.meta,
                    lifecycle: this.lifecycle,
                },
                actor,
                kind,
                input,
            )
            // A customer channel that just connected has its front door attached (a failure fails the command, as the connect handlers do).
            const channelId = connectedChannelOf(kind, input, value)
            if (channelId !== null) await this.frontDoor.ensureForConnection(actor, channelId)
            return value
        }
        // The answer is not kept on the ledger (it may hold a key or a page of data): the row the outcome is written to is its record.
        return reachesProvider(kind) ? onceAnswered(this.effects, `${job.jobId}:command`, CONNECTION_COMMAND_EFFECT, act) : act()
    }

    /** The refusal written back for the browser: the code, kind and display parameters the errors capability gives the cause. */
    private failed(cause: unknown): CommandFailed {
        const description = this.errors.describe(cause)
        return { ok: false, kind: description.kind, code: description.code, params: description.params }
    }
}
