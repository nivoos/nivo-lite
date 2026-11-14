import { graphSpecSchema } from "@nivo-lite/agent-sdk/graph"
import { stepsFlowOf } from "@/modules/plugin-registry/client"
import sale from "./__fixtures__/sale-consult.v1.json"
import { explainSectionsOf, type ExplainWords } from "./workflowExplain"
import { graphOfSpec } from "./workflowSteps"
import { framedFlowOf } from "./workflowMap"

/** The real `sales.consult` graph: the explanation of its steps reads only labels, never a key, and builds no empty section. */
const spec = graphSpecSchema.parse(sale)

const words = (locale: "vi" | "en"): ExplainWords => ({
    locale,
    required: "required",
    unnamed: "unnamed",
    members: { eventId: "Event", routeId: "Route", contactId: "Customer", accountId: "Account", startedAt: "Start" },
    titles: { what: "What", when: "When", inputs: "In", outputs: "Out", tools: "Tools", exits: "Next", call: "Call" },
    fromLabel: "From",
    fixedLabel: "Fixed",
    waitsFor: "Waits",
    waitLimit: "Limit",
    everyEvent: "Every",
    supplies: (members) => `Supplies ${members}`,
    toolActs: "Writes",
    toolReads: "Reads",
    exitNext: "Next",
    exitBack: "Back",
    callTarget: "Target",
    yes: "Yes",
    no: "No",
    number: (value) => String(value),
})

const sectionsOf = (nodeKey: string, locale: "vi" | "en" = "vi") => {
    const graph = graphOfSpec(spec, locale)
    const map = { ...framedFlowOf(stepsFlowOf(graph, locale), graph, locale), legend: [], statusLabels: { done: "", running: "", failed: "", waiting: "", skipped: "" } }
    return explainSectionsOf({ spec, graph, map, nodeKey }, words(locale))
}

const rawKey = /[a-z]+[A-Z][a-zA-Z]*|\b[a-z]+\.[a-z]+\.[a-z.]+\b/

describe("the read only explanation of a step", () => {
    it("explains a wait by what it waits for and its limit", () => {
        const when = sectionsOf("await").find((one) => one.id === "when")
        expect(when?.rows.map((row) => row.id)).toEqual(["waits", "limit"])
    })

    it("explains the trigger by its sources", () => {
        const when = sectionsOf("trigger").find((one) => one.id === "when")
        expect(when?.rows.length).toBe(1)
    })

    it("explains a hand-off by its target and what it passes", () => {
        const call = sectionsOf("to-after-sale").find((one) => one.id === "call")
        expect(call?.rows[0]?.id).toBe("target")
        expect(sectionsOf("to-after-sale").some((one) => one.id === "inputs")).toBe(false)
    })

    it("lists the exits of a step with the step each leads to", () => {
        const exits = sectionsOf("exact").find((one) => one.id === "exits")
        expect(exits?.rows.length).toBe(2)
    })

    it("never builds an empty section and never shows a raw key as a label", () => {
        for (const locale of ["vi", "en"] as const)
            for (const node of spec.nodes) {
                for (const section of sectionsOf(node.key, locale)) {
                    expect(section.rows.length).toBeGreaterThan(0)
                    for (const row of section.rows) expect(`${row.label}`).not.toMatch(rawKey)
                }
            }
    })

    it("says the kind of what a step returns", () => {
        const outputs = sectionsOf("consult").find((one) => one.id === "outputs")
        expect((outputs?.rows ?? []).length).toBeGreaterThan(0)
    })
})
