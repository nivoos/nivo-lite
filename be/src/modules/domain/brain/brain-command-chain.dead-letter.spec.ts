import { Test } from "@nestjs/testing"
import { builder, mock } from "@starci/jest-preset"
import { BrainCommandsService } from "@modules/domain/brain-commands"
import { KnowledgeDriveService, KnowledgeSearchService } from "@modules/domain/knowledge"
import { KnowledgeSourcesService } from "@modules/domain/knowledge-sources"
import { FencedProcessor, type ClaimedJob } from "@modules/platform/jobs"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import type { QueueDelivery } from "@modules/platform/queue"
import { RUN_BRAIN_COMMAND_JOB } from "@modules/queues/knowledge"
import { aiDeliveryOf, aiRunnerHarness } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { BrainCommandRunnerService } from "./brain-command-runner.service"
import { BrainLearningService } from "./brain-learning.service"
import { BrainService } from "./brain.service"
import { DocumentAreaService } from "./document-area.service"
import { BrainError, BrainErrorCode } from "./errors/brain.error"

const WS = "11111111-1111-4111-8111-111111111111"
const PAYLOAD = { commandId: "cmd-1", workspaceId: WS }

type CommandRecord = NonNullable<Awaited<ReturnType<BrainCommandsService["get"]>>>

const commandOf = builder<CommandRecord>({
    id: "cmd-1",
    workspaceId: WS,
    requestedBy: "user-1",
    kind: "gap.dismiss",
    payload: { id: "gap-1" },
    status: "queued",
})

/** The processor of the brain command job as the feature composes it: one domain method; the dead letter closes the command row. */
class CommandProcessor extends FencedProcessor {
    override readonly queue = "knowledge"
    override readonly definition = RUN_BRAIN_COMMAND_JOB
    constructor(private readonly runner: BrainCommandRunnerService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.runner.run(job)
    }
    override async onFailed(delivery: QueueDelivery): Promise<void> {
        await this.runner.giveUp(delivery.payload)
    }
}

const build = async () => {
    const commands = mock<BrainCommandsService>({
        get: jest.fn(() => Promise.resolve(commandOf())),
        begin: jest.fn(() => Promise.resolve(true)),
        reopen: jest.fn(() => Promise.resolve()),
        finish: jest.fn(() => Promise.resolve()),
        fail: jest.fn(() => Promise.resolve()),
    })
    const brain = mock<BrainService>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            BrainCommandRunnerService,
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: BrainCommandsService, useValue: commands },
            { provide: BrainService, useValue: brain },
            { provide: BrainLearningService, useValue: mock<BrainLearningService>() },
            { provide: KnowledgeSourcesService, useValue: mock<KnowledgeSourcesService>() },
            { provide: KnowledgeSearchService, useValue: mock<KnowledgeSearchService>() },
            { provide: KnowledgeDriveService, useValue: mock<KnowledgeDriveService>() },
            { provide: DocumentAreaService, useValue: mock<DocumentAreaService>() },
        ],
    }).compile()
    return { processor: new CommandProcessor(moduleRef.get(BrainCommandRunnerService)), commands, brain }
}

describe("brain command chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("a service is unavailable on every start: 1 / 2 / 4 / 8 min, then ONE item and the row says the command did not run; a resume opens it and finishes", async () => {
        const t = await build()
        const h = await aiRunnerHarness()
        h.claimed(PAYLOAD)
        t.brain.dismissGap.mockRejectedValue(new BrainError({ code: BrainErrorCode.ModelUnavailable }))

        for (const attempt of [1, 2, 3, 4]) {
            await expect(h.runner.run(t.processor, aiDeliveryOf("knowledge", RUN_BRAIN_COMMAND_JOB.name, PAYLOAD, attempt))).rejects.toMatchObject({
                code: "QUEUE_RETRY_AFTER",
                params: { seconds: [60, 120, 240, 480][attempt - 1] },
            })
        }
        expect(t.commands.fail).not.toHaveBeenCalled()

        await h.runner.run(t.processor, aiDeliveryOf("knowledge", RUN_BRAIN_COMMAND_JOB.name, PAYLOAD, 5))

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient", queue: "knowledge" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(h.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", workspaceId: WS }))
        expect(t.commands.fail.mock.calls).toEqual([[WS, "cmd-1", "BRAIN_COMMAND_FAILED"]])

        // The cause is fixed and a person presses "run again": the job opens its command and finishes it.
        const resumed = await aiRunnerHarness(1)
        resumed.claimed(PAYLOAD)
        t.brain.dismissGap.mockResolvedValue()

        await resumed.runner.run(t.processor, aiDeliveryOf("knowledge", RUN_BRAIN_COMMAND_JOB.name, PAYLOAD, 1))

        expect(t.commands.reopen.mock.calls).toEqual([[WS, "cmd-1"]])
        expect(t.commands.finish.mock.calls).toEqual([[WS, "cmd-1", null]])
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.claims.park).not.toHaveBeenCalled()
    })

    it("a refusal of the services no retry changes is the typed end of the command (the row says why), not a dead letter", async () => {
        const t = await build()
        const h = await aiRunnerHarness()
        h.claimed(PAYLOAD)
        t.brain.dismissGap.mockRejectedValue(new BrainError({ code: BrainErrorCode.CommandNotFound }))

        await h.runner.run(t.processor, aiDeliveryOf("knowledge", RUN_BRAIN_COMMAND_JOB.name, PAYLOAD, 1))

        expect(t.commands.fail.mock.calls).toEqual([[WS, "cmd-1", BrainErrorCode.CommandNotFound]])
        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(h.claims.park).not.toHaveBeenCalled()
        expect(h.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("an upkeep of ONE workspace that fails parks alone: its failure holds no other workspace back (each is its own job)", async () => {
        const t = await build()
        const h = await aiRunnerHarness()
        const upkeep = { upkeep: "workspace", workspaceId: WS, at: 60_000 }
        h.claimed(upkeep)
        t.brain.upkeepWorkspace.mockRejectedValue(new Error("a bug"))

        await h.runner.run(t.processor, aiDeliveryOf("knowledge", RUN_BRAIN_COMMAND_JOB.name, upkeep, 1))

        // A code failure is not tried again: one item at once; onFailed has no command to close.
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "code" }))
        expect(t.commands.fail).not.toHaveBeenCalled()
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
    })
})
