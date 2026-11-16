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
import { FencedProcessor, type ClaimedJob } from "@modules/platform/jobs"
import { MESSAGE_CATALOG } from "@modules/platform/i18n"
import type { MessageCatalog } from "@modules/platform/i18n"
import { SETUP_TURN_JOB } from "@modules/queues/agents"
import { aiDeliveryOf, aiRunnerHarness } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { ModulesService } from "./modules.service"
import { SetupCardsService } from "./setup-cards.service"
import { SetupTurnService } from "./setup-turn.service"
import { catalogModuleOf } from "./modules.testing"

const WS = "11111111-1111-4111-8111-111111111111"
const PAYLOAD = { workspaceId: WS, messageId: "m-2", setupSessionId: "s-1", locale: "en" }

const sessionOf = builder<SetupSessionRecord>({
    id: "s-1",
    workspaceId: WS,
    installationId: "inst-1",
    revision: 1,
    status: "draft",
    draft: { summary: "A shop.", facts: [] },
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
    workspaceId: WS,
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

const ANSWER = JSON.stringify({ reply: "Noted the hours.", summary: "", facts: [], gates: {}, writes: [] })

/** The processor of the setup-turn job as the feature composes it: one domain method; no failure hook (the turn has no reply and stays open). */
class TurnProcessor extends FencedProcessor {
    override readonly queue = "agents"
    override readonly definition = SETUP_TURN_JOB
    constructor(private readonly turns: SetupTurnService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.turns.run(job)
    }
}

const build = async () => {
    const generations = mock<GenerationsService>()
    const sessions = mock<SetupSessionsService>()
    sessions.find.mockResolvedValue(sessionOf())
    sessions.change.mockImplementation((_id, next) => {
        const change = next({ draft: sessionOf().draft, gateEvidence: sessionOf().gateEvidence })
        return Promise.resolve(change === null ? null : sessionOf({ ...change }))
    })
    const messages = mock<SetupMessagesService>()
    messages.find.mockResolvedValue(lineOf())
    messages.ofSession.mockResolvedValue([lineOf()])
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
    return { processor: new TurnProcessor(moduleRef.get(SetupTurnService)), generations, messages }
}

describe("setup turn chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume answers the turn", () => {
    it("the model is unavailable on every start: 1 / 2 / 4 / 8 min on the waited ladder, then ONE item; no busy line is written; a resume answers", async () => {
        const t = await build()
        const h = await aiRunnerHarness()
        h.claimed(PAYLOAD)
        t.generations.generate.mockResolvedValue({ ok: false, reason: "timeout", message: "busy" })

        for (const attempt of [1, 2, 3, 4]) {
            await expect(h.runner.run(t.processor, aiDeliveryOf("agents", SETUP_TURN_JOB.name, PAYLOAD, attempt))).rejects.toMatchObject({
                code: "QUEUE_RETRY_AFTER",
                params: { seconds: [60, 120, 240, 480][attempt - 1] },
            })
        }
        expect(h.claims.park).not.toHaveBeenCalled()

        await h.runner.run(t.processor, aiDeliveryOf("agents", SETUP_TURN_JOB.name, PAYLOAD, 5))

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient", queue: "agents" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(h.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", workspaceId: WS }))
        // The turn has no reply: nothing wrote a machine "busy" line; the message stays open for the resume.
        expect(t.messages.post).not.toHaveBeenCalled()

        const resumed = await aiRunnerHarness(1)
        resumed.claimed(PAYLOAD)
        t.generations.generate.mockResolvedValue({ ok: true, output: ANSWER, generationId: "gen-1", timings: {}, usage: null })

        await resumed.runner.run(t.processor, aiDeliveryOf("agents", SETUP_TURN_JOB.name, PAYLOAD, 1))

        expect(t.messages.post.mock.calls[0]?.[0]).toMatchObject({ role: "assistant", body: "Noted the hours." })
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.claims.park).not.toHaveBeenCalled()
    })

    it("an empty answer is a refusal no retry changes: parks at once (input) with ONE item and writes no busy line", async () => {
        const t = await build()
        const h = await aiRunnerHarness()
        h.claimed(PAYLOAD)
        t.generations.generate.mockResolvedValue({ ok: true, output: "", generationId: "gen-1", timings: {}, usage: null })

        await h.runner.run(t.processor, aiDeliveryOf("agents", SETUP_TURN_JOB.name, PAYLOAD, 1))

        expect(h.claims.fail).not.toHaveBeenCalled()
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: "MODULES_SETUP_TURN_REFUSED" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.messages.post).not.toHaveBeenCalled()
    })
})
