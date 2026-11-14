/** The queue name: the contract between the connection_command_submit function of the database (the producer) and the processor of the connection-commands job. */
export const CONNECTION_COMMANDS_QUEUE = "connection_commands"

/** The job name the `connection_command_submit` database function writes. */
export const CONNECTION_COMMAND_JOB = "connection.command"

/** The payload of one connection-commands job: the command row to run, ids only. */
export interface ConnectionCommandPayload {
    /** The `connection_commands` row waiting to be run. */
    readonly commandId: string
    /** The workspace of the command: the queue limits how many commands of one workspace run at once. */
    readonly workspaceId: string
}

/** True when a job payload is the payload of a connection-commands job. */
export const isConnectionCommandPayload = (value: unknown): value is ConnectionCommandPayload =>
    typeof value === "object" &&
    value !== null &&
    "commandId" in value &&
    typeof value.commandId === "string" &&
    "workspaceId" in value &&
    typeof value.workspaceId === "string"

/** The once key of one command, as the database function writes it: the command row. */
export const connectionCommandKey = (payload: ConnectionCommandPayload): string => `${CONNECTION_COMMAND_JOB}:${payload.commandId}`
