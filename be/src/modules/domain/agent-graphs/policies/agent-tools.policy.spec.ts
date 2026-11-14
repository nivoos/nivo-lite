import { coreTemplates } from "@modules/domain/installed-plugins/installed-plugins.testing"
import { GRAPH_TOOL_OUTSIDE_AGENT, withDefaultReads } from "./agent-tools.policy"
import { templateFlowProblems } from "./flow.policy"

describe("the workflow templates NIVO ships", () => {
    it("keep every step inside the tool set of the agent of their module, in every version", () => {
        // Every template is a template agent's graph, judged by `templateFlowProblems` (GRAPH_TOOL_OUTSIDE_AGENT among its problems).
        const templates = coreTemplates()
        expect(templates.length).toBeGreaterThan(0)
        const outside = templates.flatMap((template) =>
            template.versions.flatMap((version) => [
                ...templateFlowProblems(version.graph)
                    .filter((problem) => problem.code === GRAPH_TOOL_OUTSIDE_AGENT)
                    .map((problem) => `${template.id}@${String(version.version)} ${problem.at}`),
            ]),
        )
        expect(outside).toEqual([])
    })
})

describe("withDefaultReads", () => {
    it("holds every default context read, so a step reading the run's customer is never outside its agent", () => {
        expect(withDefaultReads(["nivo.tool.customer.message.send", "nivo.tool.brain.search"])).toEqual([
            "nivo.tool.customer.message.send",
            "nivo.tool.brain.search",
            "nivo.tool.brain.fact.get",
            "nivo.tool.brain.fact.related",
            "nivo.tool.brain.passage.read",
            "nivo.tool.brain.passage.search",
            "nivo.tool.contact.get",
            "nivo.tool.conversation.message.list",
            "nivo.tool.lead.care.get",
            "nivo.tool.lead.order.list",
            "nivo.tool.brain.fact.list",
            "nivo.tool.brain.policy.list",
            "nivo.tool.brain.document.read",
            "nivo.tool.record.get",
            "nivo.tool.record.list",
            "nivo.tool.record.create",
            "nivo.tool.record.update",
            "nivo.tool.file.put",
            "nivo.tool.file.link",
            "nivo.tool.file.get",
            "nivo.tool.timer.arm",
            "nivo.tool.timer.cancel",
        ])
    })
})
