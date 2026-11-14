import { Injectable } from "@nestjs/common"
import { GenerationsService } from "@modules/domain/ai-generations"
import { BrainFactsService, type FactRecord } from "@modules/domain/brain-facts"
import { InstallationRecordsService, type InstallationRecord } from "@modules/domain/module-installations"
import { SetupMessagesService, type SetupMessageRecord } from "@modules/domain/module-setup-messages"
import { SetupSessionsService, type SetupSessionRecord } from "@modules/domain/module-setup-sessions"
import type { ClaimedJob } from "@modules/platform/jobs"
import { InjectMessageCatalog, type MessageCatalog } from "@modules/platform/i18n"
import { isSetupTurnPayload, type SetupTurnPayload } from "@modules/queues/agents"
import { ModulesError, ModulesErrorCode } from "./errors/modules.error"
import { ModulesService } from "./modules.service"
import { conflictsOf, knownLinesOf, unmentionedConflicts } from "./policies/setup-facts.policy"
import { mergeSetupTurn, readSetupTurn, setupPromptOf, type SetupTurnResult } from "./policies/setup-turn.policy"
import { SetupCardsService } from "./setup-cards.service"

/** The longest the model may take to answer one turn. */
const TURN_TIMEOUT_MS = 90_000

const HISTORY_TURNS = 16
/** The most facts of the business one turn reads. */
const FACTS_READ_MAX = 500
/** The most facts that match the owner message. */
const FACT_HITS_MAX = 30

/** A turn still to answer: its draft, the owner message, the chat and where the message sits in it. */
interface OpenTurn {
    readonly session: SetupSessionRecord
    readonly message: SetupMessageRecord
    readonly chat: ReadonlyArray<SetupMessageRecord>
    readonly at: number
}

/** What is on record for one turn: every fact in force of the view, and those that match the owner message. */
interface OnRecord {
    readonly inForce: ReadonlyArray<FactRecord>
    readonly hits: ReadonlyArray<FactRecord>
}

@Injectable()
/**
 * One turn of the setup chat, worked by the setup-turn job: the owner message goes to the model once with the checklist, the draft and the
 * open customer questions; what NIVO learned is merged into the draft, the writes it implies become confirm cards and its reply is the
 * next message of the chat. The model call is an effect keyed by the job (`<jobId>:turn`), its answer kept: a job run again after a
 * crash gets the same turn and never asks (or bills) twice, and the three writes after it are safe to repeat (the merge replaces facts by
 * key, the cards supersede the ones of the same message). The reply is written last, so a turn answered already is recognised by it. A
 * model outage throws a typed transient error (the job's `waited` ladder decides), an empty answer a typed refusal (a dead letter with
 * one item); the turn then has no reply and stays open: the chat shows its own stale label and a resume answers it.
 */
export class SetupTurnService {
    constructor(
        @InjectMessageCatalog() private readonly catalog: MessageCatalog,
        private readonly facts: BrainFactsService,
        private readonly generations: GenerationsService,
        private readonly installations: InstallationRecordsService,
        private readonly sessions: SetupSessionsService,
        private readonly messages: SetupMessagesService,
        private readonly modules: ModulesService,
        private readonly cards: SetupCardsService,
    ) {}

    /** Answers the owner message the claimed job names; a closed draft or a message answered already is a normal end. */
    async run(job: ClaimedJob): Promise<void> {
        if (!isSetupTurnPayload(job.payload)) throw new ModulesError({ code: ModulesErrorCode.SetupTurnPayloadInvalid })
        await this.answer(job.payload, job.jobId)
    }

    /** The draft, the owner message and the chat of a turn still to answer; null when the payload is stale, closed or answered already. */
    private async openTurn(job: SetupTurnPayload): Promise<OpenTurn | null> {
        const session = await this.sessions.find(job.workspaceId, job.setupSessionId)
        const message = await this.messages.find(job.workspaceId, job.messageId)
        if (session?.status !== "draft" || message === null) return null
        const chat = await this.messages.ofSession(session.id)
        const at = chat.findIndex((line) => line.id === message.id)
        if (at < 0 || chat.slice(at + 1).some((line) => line.role === "assistant")) return null
        return { session, message, chat, at }
    }

    private async answer(job: SetupTurnPayload, jobId: string): Promise<void> {
        const open = await this.openTurn(job)
        if (open === null) return
        const { session, message, chat, at } = open
        const installation = await this.installations.find(job.workspaceId, session.installationId)
        if (installation === null) return
        const module = await this.modules.find(installation.moduleKey)
        const onRecord = await this.onRecordOf(job.workspaceId, module.key, installation, message.body)
        const input = {
            module,
            locale: job.locale,
            draft: session.draft,
            gates: session.gateEvidence,
            history: chat.slice(0, at).map((line) => ({ role: line.role, body: line.body })),
            message: message.body,
            gaps: await this.cards.openGapsOf(job.workspaceId, module.key),
            known: knownLinesOf(onRecord.inForce, onRecord.hits),
            words: {
                notApplicable: this.catalog.get("setup.notApplicable", {}, job.locale),
                applyButton: this.catalog.get("setup.applyButton", {}, job.locale),
                ownerAddress: this.catalog.get("setup.ownerAddress", {}, job.locale),
            },
        }
        const outcome = await this.generations.generate({
            workspaceId: job.workspaceId,
            purpose: "setup_chat",
            responseFormat: "json",
            timeoutMs: TURN_TIMEOUT_MS,
            kind: "setup",
            module: "setup",
            locale: job.locale,
            effectKey: `${jobId}:turn`,
            messages: [
                { role: "system", content: setupPromptOf(input) },
                ...input.history.slice(-HISTORY_TURNS).map((line) => ({ role: line.role, content: line.body })),
                { role: "user", content: input.message },
            ],
        })
        // The allowance is used up or the engine is not set up: a typed end the owner reads in its own sentence.
        if (!outcome.ok && (outcome.reason === "quota" || outcome.reason === "not_configured")) return this.reply(job, session.id, outcome.message)
        // The model did not answer in time or at all: it heals, so it throws and the job's ladder decides.
        if (!outcome.ok) throw new ModulesError({ code: ModulesErrorCode.SetupTurnUnavailable, params: { reason: outcome.reason } })
        // The model wrote nothing: the same prompt gets the same answer, so it is a refusal (a dead letter), never a retry.
        if (outcome.output.trim() === "") throw new ModulesError({ code: ModulesErrorCode.SetupTurnRefused })
        const turn = readSetupTurn(
            input,
            outcome.output,
            this.catalog.get("setup.noted", {}, job.locale),
            this.catalog.get("setup.business", {}, job.locale),
        )
        const saved = await this.sessions.change(session.id, (current) => {
            const merged = mergeSetupTurn(current.draft, current.gateEvidence, turn)
            return { draft: merged.draft, gateEvidence: merged.gates }
        })
        if (saved === null) return
        await this.cards.propose(job.workspaceId, session.id, message.id, turn.writes)
        await this.reply(job, session.id, this.withConflictNotes(job, turn, onRecord.inForce))
    }

    /** The facts of the business the chat may read, in the scope of the instance; a failed read throws (the runner judges it). */
    private async onRecordOf(
        workspaceId: string,
        moduleKey: string,
        installation: InstallationRecord,
        message: string,
    ): Promise<OnRecord> {
        const scope = installation.isMulti ? installation.id : null
        const inForce = await this.facts.forView(workspaceId, "internal", moduleKey, scope, FACTS_READ_MAX)
        const hits = await this.facts.search(workspaceId, "internal", moduleKey, scope, message, FACT_HITS_MAX)
        return { inForce, hits }
    }

    /** The reply, with one note per value the owner gave that differs from the one on record and the reply does not name. */
    private withConflictNotes(
        job: SetupTurnPayload,
        turn: SetupTurnResult,
        inForce: ReadonlyArray<FactRecord>,
    ): string {
        const notes = unmentionedConflicts(conflictsOf(turn.writes, inForce), turn.reply).map((conflict) =>
            this.catalog.get("setup.conflictNote", { ...conflict }, job.locale),
        )
        return [turn.reply, ...notes].join("\n\n")
    }

    private async reply(job: SetupTurnPayload, sessionId: string, body: string): Promise<void> {
        await this.messages.post({
            workspaceId: job.workspaceId,
            setupSessionId: sessionId,
            role: "assistant",
            author: "NIVO",
            body,
        })
    }
}
