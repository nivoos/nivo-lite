import { FakeClock, mock } from "@starci/jest-preset"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { GraphNodesError, GraphNodesErrorCode, type NodeToolCall, type NodeTurn } from "@modules/domain/graph-nodes"
import type { Logger } from "@modules/platform/logging"
import type { BoundAccount } from "./agent-accounts.service"
import { ToolRunnerService } from "./tool-runner.service"

/**
 * ONE ACCOUNT PER ATTEMPT (FIX-OUT, D3-W2-10 / D3-W2-11): once a call was attempted on the account the pick order chose, a failure of that
 * attempt (transient, not sent, unknown, a failed read) stays with that account; only an account that could not take the call at all
 * (not connected, its credential refused) is skipped for the next.
 */
const TURN: NodeTurn = { turnId: "run-1", workspaceId: "ws-1", agentId: "agent-1", subject: null, conversationId: null, locale: "vi" }
const STEP = { nodeKey: "cancel-request", versionId: "v-1", workflowId: "wf-1" }
const MADE_IT: BoundAccount = { provider: "payos", connectionId: "pay-1" }
const OTHER: BoundAccount = { provider: "sepay", connectionId: "bank-2" }

const callOf = (tool: string) => ({
    road: "tool" as const,
    token: "tok",
    tool,
    args: { requestRef: "1780000000049" },
    key: "run-1:cancel-request:x",
    approval: null,
    turn: TURN,
    workflowStep: STEP,
})

const runnerFailingFirstWith = (failure: GraphNodesError) => {
    const call = jest.fn<Promise<unknown>, [NodeToolCall]>()
    call.mockRejectedValueOnce(failure).mockResolvedValue({ status: "cancelled" })
    const runner = new ToolRunnerService({
        door: { call },
        registry: { executorOf: () => ({ effect: "", execute: () => Promise.reject(new Error("no effect here")) }) },
        ledger: { once: () => Promise.reject(new Error("no effect here")) },
        accounts: { boundAccountsOf: () => Promise.resolve([MADE_IT, OTHER]) },
        leads: null,
        clock: new FakeClock(new Date("2026-11-15T00:00:00.000Z")),
        logger: mock<Logger>(),
    })
    const accountsAsked = (): ReadonlyArray<string | undefined> => call.mock.calls.map(([asked]) => asked.account?.connectionId)
    return { runner, accountsAsked }
}

/** The door's failure of an attempt that reached the provider: a 429 (`not_sent`) or no answer in time (`unknown`). */
const attemptFailed = (proof: "not_sent" | "unknown"): GraphNodesError =>
    new GraphNodesError({ code: GraphNodesErrorCode.ToolFailed, params: { tool: "t", reason: "unavailable", proof } })

describe("ToolRunnerService: one account per attempt", () => {
    it.each([
        ["a cancel answered 429", TOOL.paymentRequestCancel, "not_sent"],
        ["a read answered 429", TOOL.paymentRequestGet, "not_sent"],
        ["a read with no answer in time", TOOL.paymentRequestGet, "unknown"],
        ["a create answered 429", TOOL.paymentRequestCreate, "not_sent"],
    ] as const)("keeps %s on the account it was attempted on: the failure is the step's, never another account's act", async (_case, tool, proof) => {
        const failure = attemptFailed(proof)
        const { runner, accountsAsked } = runnerFailingFirstWith(failure)
        await expect(runner.run(callOf(tool))).rejects.toBe(failure)
        expect(accountsAsked()).toEqual([MADE_IT.connectionId])
    })

    it("skips an account that could not take the call at all (nothing attempted on it) for the next", async () => {
        const { runner, accountsAsked } = runnerFailingFirstWith(
            new GraphNodesError({ code: GraphNodesErrorCode.ToolNotConnected, params: { tool: TOOL.paymentRequestCreate } }),
        )
        await expect(runner.run(callOf(TOOL.paymentRequestCreate))).resolves.toMatchObject({ via: OTHER })
        expect(accountsAsked()).toEqual([MADE_IT.connectionId, OTHER.connectionId])
    })
})
