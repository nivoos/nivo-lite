// The authoring project of the fixture package `demo-money` (be/src/tests/fixtures/cells/demo-money): typed builders that EMIT its seed files.
import {
    cellFile,
    graph,
    ifNode,
    node,
    outcome,
    packageFile,
    project,
    ref,
    set,
    wait,
    when,
} from "@nivo-lite/cells-author"

const CONTROL_INPUT = { type: "object" } as const

export default project({
    package: packageFile({ key: "demo-money", version: "1.0.0", visibility: "public", author: "NIVO fixtures" }),
    cells: [
        cellFile({
            kind: "core.if",
            key: "core.if",
            version: 1,
            title: { vi: "Rẽ nhánh theo điều kiện", en: "Branch on a condition" },
            input: CONTROL_INPUT,
            output: CONTROL_INPUT,
            config: {
                type: "object",
                required: ["when", "yes"],
                properties: { when: { type: "object" }, yes: { type: "string" }, no: { type: "string" } },
            },
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
            kind: "core.set",
            key: "core.set",
            version: 1,
            title: { vi: "Đặt biến của quy trình", en: "Set workflow variables" },
            input: CONTROL_INPUT,
            output: CONTROL_INPUT,
            config: { type: "object", required: ["set"], properties: { set: { type: "object" } } },
            semantics: { mutates: false },
        }),
        cellFile({
            kind: "core.wait",
            key: "core.wait",
            version: 1,
            title: { vi: "Chờ sự kiện", en: "Wait for an event" },
            input: CONTROL_INPUT,
            output: CONTROL_INPUT,
            config: {
                type: "object",
                required: ["keys"],
                properties: { keys: { type: "array", minItems: 1, maxItems: 5 } },
            },
            semantics: { mutates: false },
        }),
        cellFile({
            kind: "node",
            key: "demo.ask-to-pay",
            version: 1,
            title: { vi: "Mời khách thanh toán", en: "Ask the customer to pay" },
            input: {
                type: "object",
                required: ["orderId", "total"],
                properties: { orderId: { type: "string" }, total: { type: "number" } },
            },
            output: { type: "object", required: ["payKey"], properties: { payKey: { type: "string" } } },
            semantics: {
                mutates: false,
                tools: ["nivo.tool.payment.request.create", "nivo.tool.customer.message.send"],
            },
            body: { mode: "auto", accounts: ["sepay", "payos"] },
            source: "run.js",
            origin: "run.ts",
            examples: [
                {
                    name: "asks 350,000 for DH1001",
                    input: { orderId: "DH1001", total: 350000 },
                    tools: [
                        { id: "nivo.tool.payment.request.create", answer: { ok: true, value: { payKey: "DH1001" } } },
                        { id: "nivo.tool.customer.message.send", answer: { ok: true, value: { delivered: true } } },
                    ],
                    expect: { ok: { payKey: "DH1001" } },
                },
                {
                    name: "cannot when the request is refused",
                    input: { orderId: "DH1002", total: 0 },
                    tools: [
                        { id: "nivo.tool.payment.request.create", answer: { ok: false, refusal: "amount_invalid" } },
                    ],
                    expect: { ending: "cannot" },
                },
            ],
        }),
        cellFile({
            kind: "tool",
            key: "nivo.tool.customer.message.send",
            version: 1,
            title: { vi: "Gửi tin cho khách", en: "Send the customer a message" },
            input: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
            output: { type: "object", required: ["delivered"], properties: { delivered: { type: "boolean" } } },
            semantics: {
                mutates: true,
                outside: true,
                repeatable: false,
                refusals: ["customer_blocked"],
                finalRefusals: ["customer_blocked"],
            },
            body: { account: "any", servedBy: "primitive:customer.message.send" },
        }),
        cellFile({
            kind: "tool",
            key: "nivo.tool.payment.request.create",
            version: 1,
            title: { vi: "Tạo yêu cầu thanh toán", en: "Create a payment request" },
            input: {
                type: "object",
                required: ["amountVnd", "reference"],
                properties: { amountVnd: { type: "integer", minimum: 1 }, reference: { type: "string" } },
            },
            output: { type: "object", required: ["payKey"], properties: { payKey: { type: "string" } } },
            semantics: {
                mutates: true,
                outside: true,
                repeatable: false,
                onceBy: ["reference"],
                refusals: ["amount_invalid", "account_closed"],
                finalRefusals: ["account_closed"],
                confirmBy: {
                    tool: "nivo.tool.payment.request.read",
                    args: { payKey: { from: "args", member: "reference" } },
                    happened: { member: "found", equals: true },
                },
            },
            body: { account: "owner", servedBy: { sepay: "nivo.api.sepay.payment.create" } },
        }),
        cellFile({
            kind: "tool",
            key: "nivo.tool.payment.request.read",
            version: 1,
            title: { vi: "Đọc yêu cầu thanh toán", en: "Read a payment request" },
            input: { type: "object", required: ["payKey"], properties: { payKey: { type: "string" } } },
            output: {
                type: "object",
                required: ["found"],
                properties: { found: { type: "boolean" }, status: { type: "string" } },
            },
            semantics: { mutates: false, refusals: ["not_found"] },
            body: { account: "owner", servedBy: { sepay: "nivo.api.sepay.payment.get" } },
        }),
        cellFile({
            kind: "trigger",
            key: "demo.bank-credit",
            version: 1,
            title: { vi: "Tiền về tài khoản", en: "A bank credit arrived" },
            input: {
                type: "object",
                required: ["id", "amount", "content"],
                properties: { id: { type: "string" }, amount: { type: "number" }, content: { type: "string" } },
            },
            output: {
                type: "object",
                required: ["creditId", "amountVnd", "content"],
                properties: {
                    creditId: { type: "string" },
                    amountVnd: { type: "number" },
                    content: { type: "string" },
                },
            },
            semantics: { mutates: false },
            body: { via: "webhook", dataType: "bank-credit", factKey: "creditId" },
            source: "translate.js",
            origin: "translate.ts",
            examples: [
                {
                    name: "turns a raw credit into a fact",
                    input: { id: "C1", amount: 350000, content: "DH1001 thanh toan" },
                    expect: { ok: { creditId: "C1", amountVnd: 350000, content: "DH1001 thanh toan" } },
                },
            ],
        }),
    ],
    graphs: [
        graph({
            key: "demo.payment",
            version: 1,
            start: "remember",
            triggers: [{ verb: "nivo.trigger.payment.credit.received", accounts: ["sepay"] }],
            vars: { paidAmount: { schema: { type: "number" } } },
            steps: {
                remember: set({ paidAmount: ref("trigger.data.amountVnd") }, { next: "match" }),
                match: ifNode({
                    label: { vi: "Đủ tiền?", en: "Paid in full?" },
                    when: when.gte(ref("vars.paidAmount"), ref("trigger.data.total")),
                    yes: "paid",
                    no: "ask",
                }),
                ask: node(
                    { key: "demo.ask-to-pay", version: 1 },
                    {
                        input: { orderId: ref("trigger.data.orderId"), total: ref("trigger.data.total") },
                        accounts: ["sepay"],
                        next: "wait",
                    },
                ),
                wait: wait({
                    keys: [
                        {
                            verb: "nivo.trigger.payment.credit.received",
                            where: when.present(ref("trigger.data.creditId")),
                        },
                    ],
                    timeout: { hours: 24 },
                    next: "paid",
                    onTimeout: "unpaid",
                }),
                paid: outcome({
                    name: "paid",
                    output: { payKey: ref("steps.ask.output.payKey"), amountVnd: ref("vars.paidAmount") },
                }),
                unpaid: outcome({ name: "unpaid" }),
            },
        }),
    ],
})
