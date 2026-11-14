import { Test } from "@nestjs/testing"
import { FakeClock, mock } from "@starci/jest-preset"
import type { NodeTurn } from "@modules/domain/graph-nodes"
import { ToolsError, ToolsErrorCode } from "@modules/domain/tools"
import { CLOCK } from "@modules/platform/clock"
import { BrainNativeService } from "./brain-native.service"
import { BrainPolicyPreReadService, POLICY_PREREAD_WINDOW_MS } from "./brain-policy-preread.service"

const TURN = { turnId: "t-1", workspaceId: "ws-1", agentId: "agent-1", subject: null, conversationId: null, locale: "vi" } as unknown as NodeTurn
const ANSWER = { notice: "N", total: 1, policies: [{ id: "f-1", group: "G", title: "T", value: "1", unit: null, until: null }] }

const build = async () => {
    const brain = mock<BrainNativeService>()
    const clock = new FakeClock("2026-11-14T10:00:00.000Z")
    brain.invoke.mockResolvedValue(ANSWER)
    const moduleRef = await Test.createTestingModule({
        providers: [BrainPolicyPreReadService, { provide: BrainNativeService, useValue: brain }, { provide: CLOCK, useValue: clock }],
    }).compile()
    return { reader: moduleRef.get(BrainPolicyPreReadService), brain, clock }
}

describe("BrainPolicyPreReadService: the engine's pre-read of nivo.tool.brain.policy.list (L2)", () => {
    it("asks the brain policy tool itself, as the turn's agent in a workflow step with the turn's conversation", async () => {
        const { reader, brain } = await build()

        await expect(reader.policiesOf({ ...TURN, conversationId: "conv-1" })).resolves.toBe(ANSWER)
        expect(brain.invoke).toHaveBeenCalledWith("ws-1", "policy.list", { limit: 200 }, {
            agentId: "agent-1",
            conversationId: "conv-1",
            graphStep: true,
        })
    })

    it("reads once per workspace, agent and audience for the cache window: the steps share it; a changed policy shows once after it", async () => {
        const { reader, brain, clock } = await build()

        await reader.policiesOf(TURN)
        await reader.policiesOf({ ...TURN, turnId: "t-2" })
        await reader.policiesOf({ ...TURN, conversationId: "conv-1" })
        expect(brain.invoke).toHaveBeenCalledTimes(2)

        clock.advance(POLICY_PREREAD_WINDOW_MS)
        await reader.policiesOf(TURN)
        expect(brain.invoke).toHaveBeenCalledTimes(3)
    })

    it("answers the tool's own refusal as the refusal fact (no L2), and holds no engine failure", async () => {
        const { reader, brain } = await build()
        brain.invoke.mockRejectedValueOnce(
            new ToolsError({ code: ToolsErrorCode.NativeRefused, params: { reason: "not_found", refusalClass: "input" } }),
        )
        await expect(reader.policiesOf(TURN)).resolves.toEqual({ ok: false, refusal: "not_found", facts: {} })

        const { reader: second, brain: failing } = await build()
        failing.invoke.mockRejectedValueOnce(new Error("db down"))
        await expect(second.policiesOf(TURN)).rejects.toThrow("db down")
        await expect(second.policiesOf(TURN)).resolves.toBe(ANSWER)
    })
})
