import { Injectable } from "@nestjs/common"
import { BRAIN_COMMAND_FAILED, BrainCommandsService, type BrainCommandResult } from "@modules/domain/brain-commands"
import { KnowledgeDriveService, KnowledgeSearchService } from "@modules/domain/knowledge"
import { KnowledgeSourcesService } from "@modules/domain/knowledge-sources"
import { isDomainError } from "@modules/platform/errors"
import type { ClaimedJob } from "@modules/platform/jobs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { classifyFailure } from "@modules/platform/queue"
import { isBrainUpkeepTickPayload, isBrainWorkspaceUpkeepPayload } from "@modules/queues/knowledge"
import { BrainLearningService } from "./brain-learning.service"
import { BrainService } from "./brain.service"
import { DocumentAreaService } from "./document-area.service"
import { commandPayloadOf } from "./command-job.policy"
import { commandOf, type BrainCommand } from "./command-payload.policy"
import { BrainLogEvent } from "./brain.log-events"
import type { CommandOutcome } from "./brain.contracts"
import { BrainError, BrainErrorCode } from "./errors/brain.error"

/** The stored code of a command whose kind or fields are not valid. */
const INVALID = "BRAIN_COMMAND_INVALID"

@Injectable()
/**
 * Carries out the commands the Second Brain and Knowledge pages ask for. The page cannot reach the back end, so it writes a command
 * row and queues a job; this runs it as the person who asked (every service proves their role again), and closes the row with the
 * result, or with the stored code of the refusal, for the page to read.
 */
export class BrainCommandRunnerService {
    constructor(
        @InjectLogger() private readonly logger: Logger,
        private readonly commands: BrainCommandsService,
        private readonly brain: BrainService,
        private readonly learning: BrainLearningService,
        private readonly sources: KnowledgeSourcesService,
        private readonly search: KnowledgeSearchService,
        private readonly drive: KnowledgeDriveService,
        private readonly areas: DocumentAreaService,
    ) {}

    /**
     * Runs the job: the timed upkeep tick (asks the upkeep of every workspace where it is due), the upkeep of one workspace, or the command a
     * job names. A refusal of the services that no retry changes is a normal end (the row says why, with the stored code); a failure that
     * heals, and anything else, is thrown for the runner to judge. A job a person handed back after its dead letter opens its command again.
     */
    async run(job: ClaimedJob): Promise<CommandOutcome> {
        const payload = job.payload
        if (isBrainUpkeepTickPayload(payload)) {
            await this.brain.upkeep()
            return "done"
        }
        if (isBrainWorkspaceUpkeepPayload(payload)) {
            await this.brain.upkeepWorkspace(payload.workspaceId)
            return "done"
        }
        const ref = commandPayloadOf(payload)
        if (ref === null) throw new BrainError({ code: BrainErrorCode.PayloadInvalid })
        if ((job.resumeCount ?? 0) > 0) await this.commands.reopen(ref.workspaceId, ref.commandId)
        const command = await this.commands.get(ref.workspaceId, ref.commandId)
        if (command === null || command.status === "done" || command.status === "failed") return "skipped"
        if (!(await this.commands.begin(ref.workspaceId, ref.commandId))) return "skipped"
        const parsed = commandOf(command.kind, command.payload)
        if (parsed === null) {
            await this.commands.fail(ref.workspaceId, ref.commandId, INVALID)
            return "failed"
        }
        try {
            const result = await this.execute(command.requestedBy, ref.workspaceId, parsed, job)
            await this.commands.finish(ref.workspaceId, ref.commandId, result)
            return "done"
        } catch (cause) {
            // The services' answer is the command's own typed refusal (the row says why) when it is a capability error the runner's
            // classifier does not call transient; a failure that heals is not an answer: it is thrown and the job's ladder decides.
            if (!isDomainError(cause) || classifyFailure(cause) === "transient") throw cause
            this.logger.warn(BrainLogEvent.CommandRefused, { code: cause.code, commandId: ref.commandId })
            await this.commands.fail(ref.workspaceId, ref.commandId, cause.code)
            return "failed"
        }
    }

    /** The job was dead-lettered (one item for a person): the command row says it did not run; a resume of the job opens it again. */
    async giveUp(payload: object): Promise<void> {
        const ref = commandPayloadOf(payload)
        if (ref !== null) await this.commands.fail(ref.workspaceId, ref.commandId, BRAIN_COMMAND_FAILED)
    }

    /** Does what the command asks, for the person who asked; answers what the page shows. */
    private async execute(userId: string, workspaceId: string, command: BrainCommand, job: ClaimedJob): Promise<BrainCommandResult> {
        switch (command.kind) {
            case "fact.save": {
                const saved = await this.brain.saveFact(userId, workspaceId, command.form)
                return { outcome: saved.outcome, factId: saved.fact.id }
            }
            case "fact.decide": {
                const fact = await this.brain.decideFact(userId, { workspaceId, ...command.decision })
                return { factId: fact.id }
            }
            case "fact.keep": {
                const rejected = await this.brain.keepCurrent(userId, { workspaceId, ...command.keep })
                return { rejected }
            }
            case "lesson.save": {
                const lesson = await this.brain.saveLesson(userId, { workspaceId, ...command.form })
                return { lessonId: lesson.id }
            }
            case "lesson.decide": {
                const lesson = await this.brain.decideLesson(userId, { workspaceId, ...command.decision })
                return { lessonId: lesson.id }
            }
            case "gap.dismiss":
                await this.brain.dismissGap(userId, workspaceId, command.id)
                return null
            case "brain.maintain":
                await this.brain.maintain(userId, workspaceId)
                return null
            case "lessons.mine":
                // The model call of the lessons is a generation keyed by the job: a command run again never asks (or bills) twice.
                return this.learning.mine(userId, workspaceId, command.module, `${job.jobId}:lessons`)
            case "source.delete":
                await this.brain.removeSource(userId, workspaceId, command.sourceId)
                return null
            case "source.reindex":
                return this.sources.reindexSource(userId, workspaceId, command.reindex)
            case "source.update":
                // One door for a change of metadata: a change of area moves the document's truths too (`DocumentAreaService`).
                await this.areas.update(userId, workspaceId, command.update)
                return null
            case "knowledge.ask":
                return { passages: await this.search.ask(userId, workspaceId, command.ask) }
            case "drive.linked":
                return this.drive.listLinkedFolder(userId, workspaceId, command.url)
            case "drive.picked":
                return this.drive.listPickedFolder(userId, workspaceId, command.picked.folderId, command.picked.token)
        }
    }
}
