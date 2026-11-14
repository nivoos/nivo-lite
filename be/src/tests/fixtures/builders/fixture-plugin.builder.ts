import { definePlugin, type Plugin } from "@nivo-lite/agent-sdk/installation"
import { defineModule, type ModuleDeclaration, type ModuleServer } from "@nivo-lite/agent-sdk/module"
import { defineEffect, defineNode, type EffectDefinition, type NodeDefinition } from "@nivo-lite/agent-sdk/node"
import {
    defineTemplateAgent,
    defineTemplateGraph,
    defineTemplateNode,
    node,
    outcome,
    ref,
    toolOk,
    trigger,
    type TemplateAgent,
    type TemplateGraph,
    type WorkflowTemplate,
} from "@nivo-lite/agent-sdk/template"
import { PROVIDER, TOOL, TRIGGER } from "@nivo-lite/agent-sdk/names"
import { defineInstallation } from "@nivo-lite/agent-sdk/installation"
import { BASE_PLUGIN } from "./base-plugin.builder"
import { installedPluginsOf } from "@modules/domain/installed-plugins/installed-plugins.policy"
import { z } from "zod"

/** The key of the fixture plugin's one module. */
export const FIXTURE_MODULE = "fixdesk"

/** The enterprise identifier the fixture plugin belongs to. */
export const FIXTURE_ENTERPRISE = "fixture-co"

/** The fixture plugin's own tool: an effect no other plugin declares. */
export const FIXTURE_TOOL = "fixdesk.ticket.open"

/** The guidance the fixture agent declares, in both languages. */
export const FIXTURE_GUIDANCE = { vi: "Mo phieu truoc, tra loi sau.", en: "Open a ticket first, answer after." }

/** The words the fixture plugin gives the model for the title of its own tool. */
export const FIXTURE_TOOL_WORDS = "Opens a support ticket for the customer of the run"

const ticketOpen: EffectDefinition = defineEffect({
    id: FIXTURE_TOOL,
    title: { key: "fixdeskTicketOpen" },
    payload: z.object({ subject: z.string().max(200) }),
})

/** A step that opens a ticket (its own tool) and tells the team (a core tool the agent reuses); it answers what it was given. */
const intake: NodeDefinition = defineNode({
    id: "fixdesk.intake",
    role: "execute",
    title: { key: "fixdeskIntake" },
    params: z.object({}),
    input: z.object({ subject: z.string().max(200) }),
    output: z.object({ opened: z.string().max(200) }),
    effects: [FIXTURE_TOOL, TOOL.teamMessagePost],
    run: (input) => Promise.resolve({ opened: input.subject }),
    examples: [{ name: "one", params: {}, input: { subject: "s" }, output: { opened: "s" }, effects: [] }],
})

/** The step of the fixture's template workflows (a TEMPLATE node, the road production runs): it reads the contact (a default read every agent holds) and answers the subject it was given. */
const open = defineTemplateNode({
    id: "fixdesk.open",
    title: { vi: "Mở phiếu", en: "Open a ticket" },
    description: { vi: "Nút thử nghiệm của bộ kiểm tra.", en: "A test node of the checks." },
    tools: [TOOL.contactGet],
    mode: "auto",
    accounts: [],
    input: z.object({ subject: z.string().max(200) }),
    output: z.object({ opened: z.string().max(200) }),
    run: async (input, ctx) => {
        await ctx.tools.call(TOOL.contactGet, {})
        return { opened: input.subject }
    },
    examples: [
        {
            name: "opens the ticket",
            params: {},
            input: { subject: "s" },
            tools: [{ id: TOOL.contactGet, answer: toolOk({}) }],
            output: { opened: "s" },
        },
    ],
})

const declaration: ModuleDeclaration = defineModule({
    key: FIXTURE_MODULE,
    namespace: FIXTURE_MODULE,
    permissions: [],
    reads: [],
    actions: [],
    specs: [],
    agent: {
        tools: [TOOL.teamMessagePost, FIXTURE_TOOL],
        abilities: { kinds: { messaging: { "customer.send": "ask" } } },
    },
})

/** The catalogue template of the fixture module: the shape of a shipped one, written out under the fixture's own key, handle and names. */
const server = (): ModuleServer => ({
    key: FIXTURE_MODULE,
    template: {
        key: FIXTURE_MODULE,
        order: 9000,
        name: { vi: "Ban ho tro", en: "Help desk" },
        shortName: { vi: "Ho tro", en: "Desk" },
        description: { vi: "Mot ban ho tro thu", en: "A fixture help desk" },
        points: { vi: ["Mo phieu"], en: ["Opens tickets"] },
        purpose: "Opens a support ticket for the customer of the run.",
        icon: "saved",
        glyph: "M5 5h14v15H5z",
        mascot: "/images/promo/mascot-point.png",
        category: "operations",
        status: "early",
        audience: "customer",
        includedWithWorkspace: false,
        available: true,
        knowledgeFolder: FIXTURE_MODULE,
        workbench: null,
        settingsExtras: null,
        requires: { capabilities: ["customer_chat"], connections: [] },
        connectionProviders: ["telegram"],
        defaultOperatingMode: "assist",
        multiInstance: false,
        agent: {
            label: { vi: "Ho tro", en: "Desk" },
            handle: FIXTURE_MODULE,
            summary: { vi: "Mo phieu ho tro", en: "Opens support tickets" },
            capabilities: { vi: ["Mo phieu"], en: ["Open tickets"] },
            role: { vi: "Nhan vien ho tro", en: "Support agent" },
            instructions: { vi: "Mo phieu truoc, tra loi sau.", en: "Open a ticket first, answer after." },
        },
        gates: [
            {
                key: "hours",
                label_vi: "Gio ho tro",
                label_en: "Support hours",
                hint_vi: "Doi ho tro lam viec luc nao",
                hint_en: "When the desk works",
            },
        ],
    },
})

/** A fixture workflow: one step of the fixture's template node, then its outcome. */
const graphOf = (slug: string): TemplateGraph =>
    defineTemplateGraph({
        key: `${FIXTURE_MODULE}.${slug}`,
        title: { vi: `Quy trinh ${slug}`, en: `Workflow ${slug}` },
        input: z.object({ subject: z.string().max(200) }),
        triggers: [trigger(TRIGGER.workflowCalled)],
        openTo: "any",
        start: "open",
        nodes: {
            open: node(open, { input: { subject: ref("trigger.subject") }, next: "opened" }),
            opened: outcome({ name: "opened" }),
        },
    })

/** The fixture's template agent: the primary workflow and a secondary one (the module's workflow templates are their graphs). */
export const FIXTURE_AGENT_TEMPLATE: TemplateAgent = defineTemplateAgent({
    key: FIXTURE_MODULE,
    label: { vi: "Ho tro", en: "Desk" },
    accounts: [PROVIDER.zaloOa],
    graphs: [graphOf("ticket"), graphOf("followup")],
    primary: `${FIXTURE_MODULE}.ticket`,
})

/**
 * A tiny PRIVATE plugin, made the way a plugin package is (`definePlugin`): one module with an agent (two tools: a core tool it reuses
 * and one of its own), a legacy node and a template agent whose two graphs are its primary and its secondary workflow template, the words of its tool, a declared tool mode and a node
 * model. It belongs to the enterprise `fixture-co`. Tests put it in the installation's array beside the core plugin.
 */
export const FIXTURE_PLUGIN: Plugin = definePlugin({
    key: "fixture",
    label: { vi: "Thu", en: "Fixture" },
    visibility: "private",
    enterprises: [FIXTURE_ENTERPRISE],
    modules: [declaration],
    servers: [server()],
    nodes: [intake],
    templateAgents: [FIXTURE_AGENT_TEMPLATE],
    effects: [ticketOpen],
    toolLabels: {
        [FIXTURE_TOOL]: {
            kind: "acts",
            title: { vi: "Mo phieu", en: "Open a ticket" },
            summary: { vi: "Mo mot phieu ho tro.", en: "Opens a support ticket." },
        },
    },
    nodeModels: { "fixdesk.intake": { model: "auto", weight: "light" } },
    guidance: (moduleKey, locale) => (moduleKey === FIXTURE_MODULE ? `POLICY: ${FIXTURE_GUIDANCE[locale]}` : ""),
    words: (key) => (key === "fixdeskTicketOpen" ? FIXTURE_TOOL_WORDS : undefined),
})

/** The workflow templates of the fixture module as an installation derives them from its graphs (primary first), and how the engine reads them. */
const FIXTURE_TEMPLATES: ReadonlyArray<WorkflowTemplate> = installedPluginsOf(defineInstallation([BASE_PLUGIN, FIXTURE_PLUGIN], "fixture")).templatesOf(FIXTURE_MODULE)

/** The primary workflow template of the fixture module, and its secondary one. */
export const FIXTURE_PRIMARY: WorkflowTemplate = FIXTURE_TEMPLATES.find((template) => template.primary)!
export const FIXTURE_SECONDARY: WorkflowTemplate = FIXTURE_TEMPLATES.find((template) => !template.primary)!
