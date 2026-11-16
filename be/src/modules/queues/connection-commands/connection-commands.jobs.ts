import { defineJob, type JobDefinition, type JobEffectDeclaration } from "@modules/platform/jobs"
import {
    CONNECTION_COMMAND_JOB,
    CONNECTION_COMMANDS_QUEUE,
    connectionCommandKey,
    isConnectionCommandPayload,
    type ConnectionCommandPayload,
} from "./connection-commands.queue"

/**
 * The outside act of a command that reaches a provider (a bot or webhook registered or removed, a test sent, a sign-in step): ONE effect
 * per command, keyed by the command row. Every one is repeatable: a provider call that registers, removes or probes gives the same
 * state when made again, and a test event sent twice is a flagged sample. An act whose outcome was lost is made again under the same key.
 */
export const CONNECTION_COMMAND_EFFECT: JobEffectDeclaration = { name: "connection.command", settle: "repeatable" }

/**
 * A console command a member submitted and watches (its outcome is written on its row): `waited`. The producer is the
 * `connection_command_submit` database function, which writes the row and the job in one transaction (its dedupe key is `onceKey`).
 * A command that connects a customer channel hands the channel its front door in the same run; the front door is idempotent.
 */
export const RUN_CONNECTION_COMMAND_JOB: JobDefinition<ConnectionCommandPayload> = defineJob<ConnectionCommandPayload>({
    name: CONNECTION_COMMAND_JOB,
    queue: CONNECTION_COMMANDS_QUEUE,
    ladder: "waited",
    payload: isConnectionCommandPayload,
    onceKey: connectionCommandKey,
    next: [],
    effects: [CONNECTION_COMMAND_EFFECT],
})
