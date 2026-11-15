import type { ModuleServer, ModuleTemplate } from "@nivo-lite/agent-sdk/module"
import { knowledgeIdeasOf } from "../../../shared/modules/knowledge-ideas/knowledge-ideas"
import { LEAD_GEN_COPY as copy } from "./copy"
import { LEAD_GEN_GATES } from "./lead-gen-gates"

/** The lead_gen module: its copy and agent; the gates live beside it. */
export const LEAD_GEN_TEMPLATE: ModuleTemplate = {
    key: "lead_gen",
    order: 15,
    name: copy.text("name"),
    shortName: copy.text("shortName"),
    description: copy.text("description"),
    points: copy.list(["points.0", "points.1", "points.2"]),
    purpose: copy.one("purpose", "en"),
    icon: "community",
    glyph: "M4 5h16l-6 8v6l-4-2v-4z",
    mascot: "/images/promo/mascot-chat.png",
    category: "sales_customer",
    status: "early",
    audience: "customer",
    includedWithWorkspace: false,
    // Not built yet: no module declaration, no agent, no graph, and no workbench registered under `lead_gen`. The template stays; the catalogue does not offer it (the availability gate of the registry spec lifts this when it is built).
    available: false,
    knowledgeFolder: "lead_gen",
    knowledgeIdeas: knowledgeIdeasOf(["lead_icp", "lead_questions", "lead_scoring", "lead_objections", "lead_offers", "lead_forbidden_claims", "lead_routing", "brand_voice"]),
    workbench: "lead_gen",
    settingsExtras: null,
    requires: {
        capabilities: [],
        connections: ["meta"],
    },
    connectionProviders: ["meta"],
    defaultOperatingMode: "assist",
    multiInstance: true,
    agent: {
        label: copy.text("agent.label"),
        handle: "leadgen",
        summary: copy.text("agent.summary"),
        capabilities: copy.list([
            "agent.capabilities.0",
            "agent.capabilities.1",
            "agent.capabilities.2",
            "agent.capabilities.3",
            "agent.capabilities.4",
        ]),
        role: copy.text("agent.role"),
        instructions: copy.text("agent.instructions"),
    },
    gates: LEAD_GEN_GATES,
}

/** The lead gen module as the catalogue lists it: its template, read by the host through the installation. */
export const LEAD_GEN_SERVER: ModuleServer = { key: "lead_gen", template: LEAD_GEN_TEMPLATE }
