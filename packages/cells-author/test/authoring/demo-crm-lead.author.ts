// The authoring project of the fixture package `demo-crm-lead` (be/src/tests/fixtures/cells/demo-crm-lead): typed builders that EMIT its seed files.
import { cellFile, graph, loop, node, outcome, packageFile, project, ref } from "../../src/index"

const CONTROL_INPUT = { type: "object" } as const

export default project({
    package: packageFile({ key: "demo-crm-lead", version: "1.0.0", visibility: "public", author: "NIVO fixtures" }),
    cells: [
        cellFile({
            kind: "core.loop",
            key: "core.loop",
            version: 1,
            title: { vi: "Lặp qua danh sách", en: "Loop over a list" },
            input: CONTROL_INPUT,
            output: CONTROL_INPUT,
            config: { type: "object", properties: { over: { type: "object" }, key: { type: "string" }, max: { type: "integer", minimum: 1, maximum: 50 } } },
            semantics: { mutates: false },
        }),
        cellFile({
            kind: "core.outcome",
            key: "core.outcome",
            version: 1,
            title: { vi: "Kết quả của quy trình", en: "The workflow outcome" },
            input: CONTROL_INPUT,
            output: CONTROL_INPUT,
            config: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
            semantics: { mutates: false },
        }),
        cellFile({
            kind: "node",
            key: "demo.file-lead",
            version: 1,
            title: { vi: "Ghi một lead", en: "File one lead" },
            input: {
                type: "object",
                required: ["recordId", "name", "email"],
                properties: { recordId: { type: "string" }, name: { type: "string" }, email: { type: "string" } },
            },
            output: { type: "object", required: ["leadId"], properties: { leadId: { type: "string" } } },
            semantics: { mutates: false, tools: ["demo.model.complete", "nivo.tool.crm.lead.create", "nivo.tool.record.update"] },
            body: { mode: "auto", accounts: ["demo-crm"] },
            source: "run.js",
            origin: "run.ts",
            examples: [
                {
                    name: "files Lan and updates the record",
                    input: { recordId: "R1", name: "Lan", email: "lan@example.test" },
                    tools: [
                        { id: "demo.model.complete", answer: { ok: true, value: { text: "Lan wants a quote" } } },
                        { id: "nivo.tool.crm.lead.create", answer: { ok: true, value: { leadId: "L1" } } },
                        { id: "nivo.tool.record.update", answer: { ok: true, value: { updated: true } } },
                    ],
                    expect: { ok: { leadId: "L1" } },
                },
                {
                    name: "cannot when the CRM refuses the lead",
                    input: { recordId: "R2", name: "", email: "bad" },
                    tools: [
                        { id: "demo.model.complete", answer: { ok: true, value: { text: "" } } },
                        { id: "nivo.tool.crm.lead.create", answer: { ok: false, refusal: "invalid_lead" } },
                    ],
                    expect: { ending: "cannot" },
                },
            ],
        }),
        cellFile({
            kind: "operation",
            key: "nivo.api.crm.demo.post.leads",
            version: 1,
            title: { vi: "Tạo lead trên CRM", en: "Post a lead to the CRM" },
            input: { type: "object", required: ["name", "email"], properties: { name: { type: "string" }, email: { type: "string" } } },
            output: { type: "object", required: ["leadId"], properties: { leadId: { type: "string" } } },
            semantics: {
                mutates: true,
                outside: true,
                repeatable: true,
                refusals: ["duplicate_email", "invalid_lead"],
                finalRefusals: ["invalid_lead"],
            },
            body: { provider: "demo.crm", method: "POST", path: "/leads", replayKeyHeader: "Idempotency-Key" },
        }),
        cellFile({
            kind: "provider",
            key: "demo.crm",
            version: 1,
            title: { vi: "CRM mẫu", en: "Demo CRM" },
            input: CONTROL_INPUT,
            output: CONTROL_INPUT,
            semantics: { mutates: false },
            body: {
                roles: ["crm"],
                auth: { scheme: "api-key" },
                baseUrl: "https://crm.example.invalid",
                accountFields: ["apiKey"],
                accountOwner: "workspace",
            },
        }),
        cellFile({
            kind: "tool",
            key: "demo.model.complete",
            version: 1,
            title: { vi: "Mô hình viết tóm tắt", en: "Model completion" },
            input: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" } } },
            output: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
            semantics: { mutates: false, metered: { usage: "tokens", price: "reported" } },
            body: { account: "any", servedBy: { model: "nivo.api.model.complete" } },
        }),
        cellFile({
            kind: "tool",
            key: "nivo.tool.crm.lead.create",
            version: 1,
            title: { vi: "Tạo lead", en: "Create a lead" },
            input: { type: "object", required: ["name", "email"], properties: { name: { type: "string" }, email: { type: "string" } } },
            output: { type: "object", required: ["leadId"], properties: { leadId: { type: "string" } } },
            semantics: {
                mutates: true,
                outside: true,
                repeatable: true,
                onceBy: ["email"],
                refusals: ["invalid_lead"],
                finalRefusals: ["invalid_lead"],
            },
            body: { account: "owner", servedBy: { "demo.crm": "nivo.api.crm.demo.post.leads" } },
        }),
        cellFile({
            kind: "tool",
            key: "nivo.tool.record.update",
            version: 1,
            title: { vi: "Cập nhật bản ghi", en: "Update a record" },
            input: { type: "object", required: ["recordId", "fields"], properties: { recordId: { type: "string" }, fields: { type: "object" } } },
            output: { type: "object", required: ["updated"], properties: { updated: { type: "boolean" } } },
            semantics: { mutates: true, outside: false, refusals: ["record_locked"] },
            body: { account: "none", servedBy: "primitive:record.update" },
        }),
    ],
    graphs: [
        graph({
            key: "demo.lead-intake",
            version: 1,
            start: "each",
            triggers: [{ verb: "nivo.trigger.crm.leads.received", accounts: ["demo-crm"] }],
            steps: {
                each: loop({
                    over: ref("trigger.data.leads"),
                    key: "email",
                    max: 50,
                    concurrency: 1,
                    body: {
                        start: "file",
                        steps: {
                            file: node(
                                { key: "demo.file-lead", version: 1 },
                                {
                                    input: { recordId: ref("item.recordId"), name: ref("item.name"), email: ref("item.email") },
                                    accounts: ["demo-crm"],
                                },
                            ),
                        },
                    },
                    next: "done",
                }),
                done: outcome({ name: "filed" }),
            },
        }),
    ],
})
