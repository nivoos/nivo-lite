import { Test } from "@nestjs/testing"
import { builder, mock } from "@starci/jest-preset"
import { BrainCommandsService } from "@modules/domain/brain-commands"
import { KnowledgeDriveService, KnowledgeSearchService } from "@modules/domain/knowledge"
import { KnowledgeSourcesService } from "@modules/domain/knowledge-sources"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { aiKilled, claimedAiJob } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { BrainCommandRunnerService } from "./brain-command-runner.service"
import { BrainLearningService } from "./brain-learning.service"
import { BrainService } from "./brain.service"
import { DocumentAreaService } from "./document-area.service"

type CommandRecord = NonNullable<Awaited<ReturnType<BrainCommandsService["get"]>>>

const commandOf = builder<CommandRecord>({
    id: "cmd-1",
    workspaceId: "ws-1",
    requestedBy: "user-1",
    kind: "lessons.mine",
    payload: { module: "sales" },
    status: "queued",
})

const build = async () => {
    const commands = mock<BrainCommandsService>({
        get: jest.fn(() => Promise.resolve(commandOf())),
        begin: jest.fn(() => Promise.resolve(true)),
        reopen: jest.fn(() => Promise.resolve()),
        finish: jest.fn(() => Promise.resolve()),
        fail: jest.fn(() => Promise.resolve()),
    })
    const brain = mock<BrainService>()
    const learning = mock<BrainLearningService>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            BrainCommandRunnerService,
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: BrainCommandsService, useValue: commands },
            { provide: BrainService, useValue: brain },
            { provide: BrainLearningService, useValue: learning },
            { provide: KnowledgeSourcesService, useValue: mock<KnowledgeSourcesService>() },
            { provide: KnowledgeSearchService, useValue: mock<KnowledgeSearchService>() },
            { provide: KnowledgeDriveService, useValue: mock<KnowledgeDriveService>() },
            { provide: DocumentAreaService, useValue: mock<DocumentAreaService>() },
        ],
    }).compile()
    return { runner: moduleRef.get(BrainCommandRunnerService), commands, brain, learning }
}

describe("brain command chain: the job is run twice, the second run repeats no finished step and no settled effect", () => {
    it("a kill after the command ran and before its row was closed: the second run asks the model under the SAME key and closes the row once", async () => {
        const t = await build()
        const job = claimedAiJob({ commandId: "cmd-1", workspaceId: "ws-1" }, { kind: "brain.command" })
        t.learning.mine.mockResolvedValue({ corrections: 5, newCases: 1, proposed: 1 })
        // The worker is gone when it closes the row.
        t.commands.finish.mockRejectedValueOnce(aiKilled())

        await expect(t.runner.run(job)).rejects.toMatchObject({ code: "ECONNRESET" })

        // The row stays `running` (the first run took it); the same job runs again and takes it back.
        t.commands.get.mockResolvedValue(commandOf({ status: "running" }))
        await expect(t.runner.run(job)).resolves.toBe("done")

        // Both runs asked under the key of the job: the generation's effect answers the second from its ledger (kept answer).
        expect(t.learning.mine.mock.calls.map((call) => call[3])).toEqual(["job-1:lessons", "job-1:lessons"])
        expect(t.commands.finish).toHaveBeenCalledTimes(2)
        expect(t.commands.fail).not.toHaveBeenCalled()
    })

    it("a kill inside the upkeep of one workspace: the same job runs again and maintains the workspace once more (idempotent), the tick queued each workspace once", async () => {
        const t = await build()
        const job = claimedAiJob({ upkeep: "workspace", workspaceId: "ws-9", at: 60_000 }, { kind: "brain.command" })
        t.brain.upkeepWorkspace.mockRejectedValueOnce(aiKilled()).mockResolvedValueOnce(undefined)

        await expect(t.runner.run(job)).rejects.toMatchObject({ code: "ECONNRESET" })
        await expect(t.runner.run(job)).resolves.toBe("done")

        expect(t.brain.upkeepWorkspace.mock.calls).toEqual([["ws-9"], ["ws-9"]])
        expect(t.commands.get).not.toHaveBeenCalled()
    })
})
