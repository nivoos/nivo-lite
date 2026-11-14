import { Test } from "@nestjs/testing"
import { builder, mock } from "@starci/jest-preset"
import { GenerationsService } from "@modules/domain/ai-generations"
import { BrainFactsService } from "@modules/domain/brain-facts"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import type { InstallationRecord } from "@modules/domain/module-installations"
import { SetupMessagesService } from "@modules/domain/module-setup-messages"
import type { SetupMessageRecord } from "@modules/domain/module-setup-messages"
import { SetupSessionsService } from "@modules/domain/module-setup-sessions"
import type { SetupSessionRecord } from "@modules/domain/module-setup-sessions"
import { MESSAGE_CATALOG } from "@modules/platform/i18n"
import type { MessageCatalog } from "@modules/platform/i18n"
import { aiKilled, claimedAiJob } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { ModulesService } from "./modules.service"
import { SetupCardsService } from "./setup-cards.service"
import { SetupTurnService } from "./setup-turn.service"
import { catalogModuleOf } from "./modules.testing"

const PAYLOAD = { workspaceId: "ws-1", messageId: "m-2", setupSessionId: "s-1", locale: "en" }

const sessionOf = builder<SetupSessionRecord>({
    id: "s-1",
    workspaceId: "ws-1",
    installationId: "inst-1",
    revision: 1,
    status: "draft",
    draft: { summary: "A shop.", facts: [{ key: "city", text: "Hanoi" }] },
    gateEvidence: {},
    createdAt: "2026-10-01T00:00:00.000Z",
})

const lineOf = builder<SetupMessageRecord>({
    id: "m-2",
    setupSessionId: "s-1",
    role: "user",
    author: "Lan",
    body: "We open 7 to 21",
    createdAt: "2026-10-01T00:01:00.000Z",
})

const installationOf = builder<InstallationRecord>({
    id: "inst-1",
    workspaceId: "ws-1",
    moduleKey: "chatbot",
    name: "Chatbot",
    isMulti: true,
    agentId: "agent-1",
    status: "setup",
    operatingMode: "assist",
    liveEnabled: false,
    activeContextVersionId: null,
    settings: {},
    createdAt: "2026-10-01T00:00:00.000Z",
})

const ANSWER = JSON.stringify({ reply: "Noted the hours.", summary: "A bakery.", facts: [{ key: "hours", text: "Open 7 to 21" }], gates: {}, writes: [] })

describe("setup turn chain: the job is run twice, the second run asks the model for no second turn and writes no second reply", () => {
    it("a kill after the draft was merged and before the reply: the second run keys the same call, merges the same facts once and replies once", async () => {
        const generations = mock<GenerationsService>()
        generations.generate.mockResolvedValue({ ok: true, output: ANSWER, generationId: "gen-1", timings: {}, usage: null })
        const sessions = mock<SetupSessionsService>()
        sessions.find.mockResolvedValue(sessionOf())
        const stored = { current: sessionOf() }
        sessions.change.mockImplementation((_id, next) => {
            const change = next({ draft: stored.current.draft, gateEvidence: stored.current.gateEvidence })
            if (change !== null) stored.current = sessionOf({ ...stored.current, ...change })
            return Promise.resolve(stored.current)
        })
        const messages = mock<SetupMessagesService>()
        messages.find.mockResolvedValue(lineOf())
        messages.ofSession.mockResolvedValue([lineOf({ id: "m-1", body: "Hi" }), lineOf()])
        const installations = mock<InstallationRecordsService>()
        installations.find.mockResolvedValue(installationOf())
        const modules = mock<ModulesService>()
        modules.find.mockResolvedValue(catalogModuleOf("chatbot"))
        const cards = mock<SetupCardsService>()
        cards.openGapsOf.mockResolvedValue([])
        const facts = mock<BrainFactsService>()
        facts.forView.mockResolvedValue([])
        facts.search.mockResolvedValue([])
        const moduleRef = await Test.createTestingModule({
            providers: [
                SetupTurnService,
                { provide: MESSAGE_CATALOG, useValue: mock<MessageCatalog>({ get: jest.fn((key: string) => `[${key}]`) }) },
                { provide: GenerationsService, useValue: generations },
                { provide: InstallationRecordsService, useValue: installations },
                { provide: SetupSessionsService, useValue: sessions },
                { provide: SetupMessagesService, useValue: messages },
                { provide: ModulesService, useValue: modules },
                { provide: SetupCardsService, useValue: cards },
                { provide: BrainFactsService, useValue: facts },
            ],
        }).compile()
        const service = moduleRef.get(SetupTurnService)
        const job = claimedAiJob(PAYLOAD, { kind: "agents.setup_turn" })
        // The worker is gone when it writes the reply (the last step).
        messages.post.mockRejectedValueOnce(aiKilled())

        await expect(service.run(job)).rejects.toMatchObject({ code: "ECONNRESET" })

        expect(stored.current.draft.facts).toEqual([
            { key: "city", text: "Hanoi" },
            { key: "hours", text: "Open 7 to 21" },
        ])
        expect(messages.post).toHaveBeenCalledTimes(1)

        await expect(service.run(job)).resolves.toBeUndefined()

        // Both runs asked under the same key (the generation's effect answers the second from its ledger); the merge replaced the fact by its key, not twice.
        expect(generations.generate.mock.calls.map(([request]) => request.effectKey)).toEqual(["job-1:turn", "job-1:turn"])
        expect(stored.current.draft.facts).toEqual([
            { key: "city", text: "Hanoi" },
            { key: "hours", text: "Open 7 to 21" },
        ])
        expect(cards.propose).toHaveBeenCalledTimes(2)
        expect(messages.post).toHaveBeenCalledTimes(2)
        expect(messages.post.mock.calls[1]?.[0]).toMatchObject({ role: "assistant", body: "Noted the hours." })
    })
})
