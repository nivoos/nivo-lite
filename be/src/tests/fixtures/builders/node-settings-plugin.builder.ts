import { definePlugin, type Plugin } from "@nivo-lite/agent-sdk/installation"
import { PROVIDER, TOOL, TRIGGER } from "@nivo-lite/agent-sdk/names"
import {
    defineTemplateAgent,
    defineTemplateGraph,
    defineTemplateNode,
    node,
    outcome,
    ref,
    toolOk,
    toolRefused,
    trigger,
    type TemplateAgent,
    type TemplateGraph,
} from "@nivo-lite/agent-sdk/template"
import { z } from "zod"

// THE NODE SETTINGS FIXTURE (NODE-SETTINGS): a NUDGE workflow, the kind a clock starts: no inbound line woke it, so no route is the run's.
// Its one step tells a person (named by the contact, not by a route) on a messaging provider the step lists, so WHICH of the agent's
// accounts the send goes out on is the pick's: the step's chosen accounts (node settings), else the person's newest identity.

/** The template agent's key: the module of its graphs. */
export const NUDGE_AGENT = "tnudge"

/** The nudge workflow (primary). */
export const NUDGE_GRAPH = "tnudge.nudge"

const nudgeOutput = z.object({ told: z.boolean(), reason: z.string().max(80).nullable() })

/** Tells a person by their contact, with the words given: the send's receipt, or its refusal as a fact. */
export const nudgeNode = defineTemplateNode({
    id: "tnudge.nudge",
    title: { vi: "Nhắc", en: "Nudge" },
    description: { vi: "Nút thử nghiệm của bộ kiểm tra.", en: "A test node of the checks." },
    tools: [TOOL.customerMessageSend],
    mode: "auto",
    accounts: [PROVIDER.zaloOa],
    input: z.object({ contactId: z.string().max(200), text: z.string().max(500) }),
    output: nudgeOutput,
    run: async (given, ctx) => {
        const answer = await ctx.tools.call(TOOL.customerMessageSend, { contactId: given.contactId, text: given.text })
        if (answer.ok) return { told: true, reason: null }
        return { told: false, reason: answer.declined === true ? "declined" : answer.refusal }
    },
    examples: [
        {
            name: "tells the person",
            params: {},
            input: { contactId: "contact-1", text: "Hello" },
            tools: [
                { id: TOOL.customerMessageSend, args: { contactId: "contact-1", text: "Hello" }, answer: toolOk({ delivered: true }, PROVIDER.zaloOa) },
            ],
            output: { told: true, reason: null },
        },
        {
            name: "a refusal is a fact",
            params: {},
            input: { contactId: "contact-1", text: "Hello" },
            tools: [{ id: TOOL.customerMessageSend, answer: toolRefused("no_channel_identity") }],
            output: { told: false, reason: "no_channel_identity" },
        },
    ],
})

/** Nudges the person named by the trigger, then ends. Started directly by the worlds, as a clock starts it. */
export const nudgeGraph: TemplateGraph = defineTemplateGraph({
    key: NUDGE_GRAPH,
    title: { vi: NUDGE_GRAPH, en: NUDGE_GRAPH },
    input: z.object({ contactId: z.string().max(200), text: z.string().max(500) }),
    triggers: [trigger(TRIGGER.workflowCalled)],
    openTo: "any",
    start: "nudge",
    nodes: {
        nudge: node(nudgeNode, { input: { contactId: ref("trigger.contactId"), text: ref("trigger.text") }, next: "told" }),
        told: outcome({ name: "told" }),
    },
})

/** The template agent: the nudge workflow only. */
export const NUDGE_AGENT_TEMPLATE: TemplateAgent = defineTemplateAgent({
    key: NUDGE_AGENT,
    label: { vi: "Nhắc", en: "Nudge" },
    accounts: [PROVIDER.zaloOa],
    graphs: [nudgeGraph],
    primary: NUDGE_GRAPH,
})

/** The fixture plugin: the agent only (no tools, no effects). */
export const NUDGE_PLUGIN: Plugin = definePlugin({
    key: "tnudge",
    label: { vi: "Nhắc", en: "Nudge" },
    templateAgents: [NUDGE_AGENT_TEMPLATE],
})
