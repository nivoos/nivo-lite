import { Injectable } from "@nestjs/common"
import { In, type EntityManager } from "typeorm"
import { WorkspaceMembersService } from "@modules/domain/workspace-members"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import { RUN_BRAIN_COMMAND_JOB } from "@modules/queues/knowledge"
import type { BrainCommandResult, MaybeCommand, MaybeCommandState } from "./brain-commands.contracts"
import { BrainCommandEntity } from "./persistence/entities"

/** The stored code of a command whose job was dead-lettered: the page says it did not run; a resume of the job opens it again. */
export const BRAIN_COMMAND_FAILED = "BRAIN_COMMAND_FAILED"

@Injectable()
/** The commands people ask the back end to carry out: a worker takes one, and closes it with a result or a stored code. */
export class BrainCommandsService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        private readonly members: WorkspaceMembersService,
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
    ) {}

    /** A member asks for a command: the row and its job are written in one transaction; the job proves the role the command needs again. Answers the command id. */
    async request(userId: string, workspaceId: string, kind: string, payload: object): Promise<string> {
        await this.members.require(userId, workspaceId)
        return this.entityManager.transaction(async (tx) => {
            const inserted = await tx.insert(BrainCommandEntity, { workspaceId, requestedBy: userId, kind, payload })
            const id = inserted.identifiers.map((identifier) => String(identifier.id)).join("")
            const queued = { commandId: id, workspaceId }
            await this.outbox.write(tx, RUN_BRAIN_COMMAND_JOB.queue, queued, {
                job: RUN_BRAIN_COMMAND_JOB.name,
                dedupeKey: RUN_BRAIN_COMMAND_JOB.onceKey(queued),
            })
            return id
        })
    }

    /** How a command stands for the person who asked; null when they asked no such command. */
    async stateOf(userId: string, workspaceId: string, id: string): Promise<MaybeCommandState> {
        const row = await this.entityManager.findOne(BrainCommandEntity, {
            select: { status: true, result: true, errorCode: true },
            where: { workspaceId, id, requestedBy: userId },
        })
        return row === null ? null : { status: row.status, result: row.result, errorCode: row.errorCode }
    }

    /** The command, when it is there. */
    async get(workspaceId: string, id: string): Promise<MaybeCommand> {
        const row = await this.entityManager.findOne(BrainCommandEntity, { where: { workspaceId, id } })
        if (row === null) return null
        return {
            id: row.id,
            workspaceId: row.workspaceId,
            requestedBy: row.requestedBy,
            kind: row.kind,
            payload: row.payload,
            status: row.status,
        }
    }

    /** Takes the command for this worker; false when it is closed already. */
    async begin(workspaceId: string, id: string): Promise<boolean> {
        const taken = await this.entityManager.update(
            BrainCommandEntity,
            { workspaceId, id, status: In(["queued", "running"]) },
            { status: "running" },
        )
        return (taken.affected ?? 0) > 0
    }

    /**
     * Opens a command the dead letter closed as failed (`BRAIN_COMMAND_FAILED`, written when its job parked) so the job a person handed
     * back runs it: queued again, with no code and no finish time. A command a refusal closed (any other code) stays closed.
     */
    async reopen(workspaceId: string, id: string): Promise<void> {
        await this.entityManager.update(
            BrainCommandEntity,
            { workspaceId, id, status: "failed", errorCode: BRAIN_COMMAND_FAILED },
            { status: "queued", errorCode: null, finishedAt: null },
        )
    }

    /** Closes the command as done with what it produced; no result is stored as the jsonb null, as it always was. */
    async finish(workspaceId: string, id: string, result: BrainCommandResult): Promise<void> {
        await this.entityManager
            .createQueryBuilder(BrainCommandEntity, "bc")
            .update()
            .set({
                status: "done",
                result: () => ":result::jsonb",
                errorCode: null,
                payload: () => "payload - 'token'",
                finishedAt: () => "now()",
            })
            .setParameter("result", JSON.stringify(result))
            .where({ workspaceId, id })
            .execute()
    }

    /** Closes the command as failed with the stored code of the cause. */
    async fail(workspaceId: string, id: string, code: string): Promise<void> {
        await this.entityManager.update(
            BrainCommandEntity,
            { workspaceId, id },
            {
                status: "failed",
                result: null,
                errorCode: code,
                payload: () => "payload - 'token'",
                finishedAt: () => "now()",
            },
        )
    }
}
