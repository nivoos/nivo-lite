import { Test } from "@nestjs/testing"
import { FakeClock, mock } from "@starci/jest-preset"
import { defineNode } from "@nivo-lite/agent-sdk/node"
import { z } from "zod"
import { CLOCK } from "@modules/platform/clock"
import { PROBE_RUN as INPUT, armGraphNodeDoubles, probeAskOf as askOf, readingPort } from "@tests/fixtures/builders/graph-nodes.builder"
import { GraphNodesError, GraphNodesErrorCode } from "./errors/graph-nodes.error"
import { EffectOutcomeUnknownCode, EffectOutcomeUnknownError } from "./errors/graph-nodes.error"
import { GraphNodeEffectsService } from "./graph-node-effects.service"
import { GraphNodeHostService } from "./graph-node-host.service"
import { GraphNodeRegistryService } from "./graph-node-registry.service"
import { GraphNodeRunTokensService } from "./graph-node-run-tokens.service"
import { GRAPH_NODE_MODEL, GRAPH_NODE_TOOL_DOOR } from "./graph-nodes.decorators"
import type { NodeModelDoor, NodeToolDoor } from "./graph-nodes.contracts"

// SEND-ONE rule SO-4 (QUEUE-BUILD follow-up): A DECIDED STOP ENDS THE TURN. Once a call of a node's turn decided a stop (an approval
// ask, an outcome nobody knows, a failure for now), no further model call is made: the node's next model call throws the stop instead.
// Before, a node (or an agent loop) that caught the call's failure went on and asked the model again, spending a model turn for nothing:
// the step stopped anyway at its end and nothing it said was sent.

/** A node that catches its tool's failure and then asks the model: what an agent loop does after a refused turn. */
const asksAfterNode = defineNode({
    id: "core.swallow",
    role: "execute",
    title: { key: "s" },
    params: z.object({}),
    input: z.object({}),
    output: z.object({ said: z.string().max(100) }),
    effects: [],
    tools: ["core.look"],
    run: async (_input, context) => {
        try {
            await context.tools.call("core.look", {})
        } catch {
            // as a loop reads a refused turn
        }
        return { said: await context.model.text({ purpose: "after", instructions: "say", input: {} }) }
    },
    examples: [],
})

const build = async () => {
    const registry = mock<GraphNodeRegistryService>()
    const effects = mock<GraphNodeEffectsService>()
    const ai = mock<Required<NodeModelDoor>>()
    const tokens = mock<GraphNodeRunTokensService>()
    const tools = mock<NodeToolDoor>({ run: undefined })
    armGraphNodeDoubles({ registry, effects, ai, tokens, tools }, readingPort())
    registry.nodeOf.mockReturnValue(asksAfterNode)
    ai.nodeText.mockResolvedValue("said")
    const moduleRef = await Test.createTestingModule({
        providers: [
            GraphNodeHostService,
            { provide: GraphNodeRunTokensService, useValue: tokens },
            { provide: CLOCK, useValue: new FakeClock("2026-11-04T10:00:00.000Z") },
            { provide: GraphNodeRegistryService, useValue: registry },
            { provide: GraphNodeEffectsService, useValue: effects },
            { provide: GRAPH_NODE_MODEL, useValue: ai },
            { provide: GRAPH_NODE_TOOL_DOOR, useValue: tools },
        ],
    }).compile()
    return { host: moduleRef.get(GraphNodeHostService), ai, tools }
}

const RUN = { ...INPUT, nodeId: "core.swallow", input: {} }

describe("GraphNodeHostService: a decided stop ends the turn (rule SO-4)", () => {
    it.each([
        ["an approval ask", askOf()],
        ["an outcome nobody knows", new EffectOutcomeUnknownError({ code: EffectOutcomeUnknownCode.Delivery, params: { effect: "core.look" } })],
    ])("%s: the node stops with it and the model is NOT asked again", async (_name, stop) => {
        const { host, ai, tools } = await build()
        tools.call.mockRejectedValue(stop)

        await expect(host.run(RUN)).rejects.toBe(stop)
        expect(ai.nodeText).not.toHaveBeenCalled()
    })

    it("CONTROL: a failure that decides no stop leaves the node free to ask the model (it answers)", async () => {
        const { host, ai, tools } = await build()
        tools.call.mockRejectedValue(new GraphNodesError({ code: GraphNodesErrorCode.ToolNotConnected }))

        await expect(host.run(RUN)).resolves.toMatchObject({ output: { said: "said" } })
        expect(ai.nodeText).toHaveBeenCalledTimes(1)
    })
})
