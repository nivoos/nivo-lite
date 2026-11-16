import { TOOL } from "@nivo-lite/agent-sdk/names"
import { nodeIndexOf, type NodeIndex } from "@nivo-lite/agent-sdk/node"
import { INSTALLED } from "@modules/domain/installed-plugins"
import { undeclaredWritesOf } from "./tool-declarations.policy"

/** An install of these tools alone, as the registry indexes it. */
const indexOf = (tools: ReadonlyArray<Readonly<Record<string, unknown>> & { readonly id: string }>): Pick<NodeIndex, "tools"> => ({
    tools: new Map(tools.map((tool) => [tool.id, tool])) as unknown as NodeIndex["tools"],
})

// E-FIX12 gate (fixing rule 9): a tool whose write is undeclared, or declared against its core spec, is refused at boot.
describe("undeclaredWritesOf", () => {
    it("names a tool with no boolean `mutates`, and a core tool whose `mutates` contradicts its spec", () => {
        expect(
            undeclaredWritesOf(
                indexOf([
                    { id: "acme.push" },
                    { id: TOOL.customerMessageSend, mutates: false },
                    { id: TOOL.contactGet, mutates: false },
                    { id: "acme.read", mutates: false },
                ]),
            ),
        ).toEqual([
            { tool: "acme.push", why: "missing" },
            { tool: TOOL.customerMessageSend, why: "contradicts" },
        ])
    })

    it("the app's real install is sound: nothing to refuse", () => {
        expect(undeclaredWritesOf(nodeIndexOf(INSTALLED.nodeInstall()))).toEqual([])
    })
})
