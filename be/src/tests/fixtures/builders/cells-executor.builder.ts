import type { CellDefinitionView, CellRef, CellSemantics, ExecuteScope, JsonSchema } from "@modules/domain/cells"

/*
 * Rows for the executor specs (slice S4): the cells of the two fixture kinds named in be/src/tests/fixtures/cells/README.md, built in
 * memory so the specs run before and beside the seeded packages. Same keys as the fixture packages; the content is S4's own.
 */

const anyObject: JsonSchema = { type: "object" }

/** A definition row with defaults a spec overrides member by member. */
export const definitionOf = (ref: CellRef, over: Partial<CellDefinitionView> = {}): CellDefinitionView => ({
    ...ref,
    id: `id-${ref.key}`,
    packageKey: "demo",
    title: { vi: ref.key, en: ref.key },
    inputSchema: anyObject,
    outputSchema: anyObject,
    configSchema: anyObject,
    semantics: { mutates: false },
    body: {},
    sourceSha256: null,
    examples: [],
    definitionHash: "hash",
    reviewState: "approved",
    deleted: false,
    ...over,
})

/** The scope of one execution; a spec changes the members it cares about. */
export const scopeOf = (over: Partial<ExecuteScope> = {}): ExecuteScope => ({
    workspaceId: "ws-1",
    runId: "run-1",
    stepKey: "step-1",
    attempt: 1,
    enterprise: null,
    world: "live",
    ...over,
})

const payInput: JsonSchema = {
    type: "object",
    required: ["payKey", "amount"],
    properties: { payKey: { type: "string" }, amount: { type: "number" } },
    additionalProperties: false,
}
const payOutput: JsonSchema = {
    type: "object",
    required: ["payKey"],
    properties: { payKey: { type: "string" } },
}

/** `demo-money`: an outside write that is not repeatable, settled by a read. */
export const moneyCells = {
    create: definitionOf(
        { kind: "tool", key: "nivo.tool.payment.request.create", version: 1 },
        {
            inputSchema: payInput,
            outputSchema: payOutput,
            semantics: {
                mutates: true,
                refusals: ["bank_declined", "amount_invalid"],
                finalRefusals: ["amount_invalid"],
                confirmBy: {
                    tool: "nivo.tool.payment.request.read",
                    args: { payKey: { from: "args", member: "payKey" } },
                    happened: { member: "status", equals: "open" },
                },
            },
        },
    ),
    read: definitionOf({ kind: "tool", key: "nivo.tool.payment.request.read", version: 1 }, { semantics: { mutates: false, refusals: ["not_found"] } }),
    askToPay: definitionOf(
        { kind: "node", key: "demo.ask-to-pay", version: 1 },
        {
            inputSchema: payInput,
            outputSchema: payOutput,
            semantics: {
                mutates: true,
                tools: ["nivo.tool.payment.request.create", "nivo.tool.customer.message.send"],
                refusals: ["bank_declined"],
            },
            sourceSha256: "to-be-set",
        },
    ),
    bankCredit: definitionOf(
        { kind: "trigger", key: "demo.bank-credit", version: 1 },
        { inputSchema: { type: "object", required: ["raw"], properties: { raw: { type: "string" } } }, outputSchema: anyObject, sourceSha256: "to-be-set" },
    ),
} as const

const leadInput: JsonSchema = { type: "object", required: ["name"], properties: { name: { type: "string" } }, additionalProperties: false }

/** `demo-crm-lead`: a repeatable outside write with a replay key, an inside write, a metered tool. */
export const crmCells = {
    createLead: definitionOf(
        { kind: "tool", key: "nivo.tool.crm.lead.create", version: 1 },
        {
            inputSchema: leadInput,
            outputSchema: { type: "object", required: ["leadId"], properties: { leadId: { type: "string" } } },
            semantics: { mutates: true, repeatable: true, refusals: ["lead_duplicate", "crm_closed"], finalRefusals: ["lead_duplicate"] },
        },
    ),
    updateRecord: definitionOf(
        { kind: "tool", key: "nivo.tool.record.update", version: 1 },
        { semantics: { mutates: true, outside: false, refusals: ["row_locked"] } },
    ),
    complete: definitionOf(
        { kind: "tool", key: "demo.model.complete", version: 1 },
        {
            inputSchema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" } } },
            semantics: { mutates: false, metered: { usage: "tokens", price: "reported" }, refusals: ["model_busy"] },
        },
    ),
    fileLead: definitionOf(
        { kind: "node", key: "demo.file-lead", version: 1 },
        {
            inputSchema: leadInput,
            outputSchema: { type: "object", required: ["leadId"], properties: { leadId: { type: "string" } } },
            semantics: { mutates: true, repeatable: true, tools: ["nivo.tool.crm.lead.create", "nivo.tool.record.update"] },
            sourceSha256: "to-be-set",
        },
    ),
} as const

/** The control cells. */
export const controlCells = {
    ifCell: definitionOf({ kind: "core.if", key: "core.if", version: 1 }),
    setCell: definitionOf({ kind: "core.set", key: "core.set", version: 1 }),
    loopCell: definitionOf({ kind: "core.loop", key: "core.loop", version: 1 }),
} as const

/** A semantics object for table rows. */
export const semanticsOf = (over: Partial<CellSemantics>): CellSemantics => ({ mutates: false, ...over })
