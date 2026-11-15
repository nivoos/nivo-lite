import { moduleAvailabilityProblems } from "./availability"
import type { ModuleServer, ModuleTemplate } from "./module.types"

const TEXT = { vi: "v", en: "e" }
const LIST = { vi: ["v"], en: ["e"] }

const serverOf = (key: string, patch: Partial<ModuleTemplate> = {}): ModuleServer => ({
    key,
    template: {
        key,
        order: 1,
        name: TEXT,
        shortName: TEXT,
        description: TEXT,
        points: LIST,
        purpose: "p",
        icon: "i",
        glyph: "g",
        mascot: "m",
        category: "c",
        status: "early",
        audience: "customer",
        includedWithWorkspace: false,
        available: true,
        knowledgeFolder: key,
        workbench: key,
        settingsExtras: null,
        requires: { capabilities: [], connections: [] },
        connectionProviders: [],
        defaultOperatingMode: "assist",
        multiInstance: false,
        agent: { label: TEXT, handle: key, summary: TEXT, capabilities: LIST, role: TEXT, instructions: TEXT },
        gates: [],
        ...patch,
    },
})

describe("moduleAvailabilityProblems", () => {
    it("accepts a built module and a module that declares itself not available", () => {
        expect(
            moduleAvailabilityProblems({
                servers: [serverOf("alpha"), serverOf("beta", { available: false })],
                modules: [{ key: "alpha" }],
                templateAgents: [{ key: "alpha", graphs: [{}] }],
            }),
        ).toEqual([])
    })

    it("accepts a module with no workbench", () => {
        expect(
            moduleAvailabilityProblems({
                servers: [serverOf("alpha", { workbench: null })],
                modules: [{ key: "alpha" }],
                templateAgents: [{ key: "alpha", graphs: [{}] }],
            }),
        ).toEqual([])
    })

    it("names an offered module with no declaration, no agent graph and a workbench nothing registers", () => {
        expect(
            moduleAvailabilityProblems({
                servers: [serverOf("gamma", { workbench: "desk" })],
                modules: [],
                templateAgents: [{ key: "gamma", graphs: [] }],
            }),
        ).toEqual([
            { code: "MODULE_AVAILABLE_NO_DECLARATION", key: "gamma" },
            { code: "MODULE_AVAILABLE_NO_AGENT", key: "gamma" },
            { code: "MODULE_AVAILABLE_NO_WORKBENCH", key: "gamma", workbench: "desk" },
        ])
    })

    it("reads a workbench registered under its own key, apart from the module's", () => {
        expect(
            moduleAvailabilityProblems({
                servers: [serverOf("delta", { workbench: "desk" })],
                modules: [{ key: "delta" }, { key: "desk" }],
                templateAgents: [{ key: "delta", graphs: [{}] }],
            }),
        ).toEqual([])
    })
})
