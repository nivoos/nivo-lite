import { PROVIDER, TOOL } from "@nivo-lite/agent-sdk/names"
import { type TemplateNode, defineTemplateNode } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { webbooksText } from "../copy"
import { idSchema, localeSchema } from "./books-shapes"
import { misaOk, refused } from "./books.fixtures"

/**
 * The draft to issue and the renewal it belongs to. The graph reaches this step only once a draft was opened (a declined draft routes
 * away), but a branch does not narrow a ref: the draft id is typed nullable and a null one is refused exactly.
 */
const input = z.object({
    draftId: idSchema.nullable(),
    renewalId: idSchema,
    locale: localeSchema,
})

/**
 * What the issue answered: `issued` with the e-invoice service's id, its number (null when it gave none yet) and state; or, when the
 * owner declined the issue (`declined` true: a decision, the graph tells the team and ends `declined`), nothing issued: its members
 * null. A refusal of the e-invoice service is no output: the engine stops the step for a person (E-FIX12).
 */
const output = z.object({
    outcome: z
        .enum(["issued"])
        .nullable()
        .describe("`issued` when the e-invoice service issued it; null when declined."),
    invoiceNo: z
        .string()
        .min(1)
        .max(40)
        .nullable()
        .describe("The invoice number exactly as the issue answered it; null when it answered none."),
    invoiceId: z.string().min(1).max(200).nullable().describe("The e-invoice service's id of the invoice; null when none was issued."),
    state: z.string().min(1).max(40).nullable().describe("The invoice's `state` exactly as the issue answered it."),
    issuedOn: z.string().max(10).nullable().describe("The issue date (`YYYY-MM-DD`) exactly as the e-invoice service answered it; null when it gave none."),
    declined: z.boolean().describe("True when the owner declined the issue."),
})

const RENEWAL_ID = "5b0f3c1e-2d4a-4e6b-8c7d-9a0b1c2d3e4f"
const DRAFT_ID = "6c1a4d2f-3e5b-4f7c-9d8e-0b1c2d3e4f5a"

const GIVEN = { draftId: DRAFT_ID, renewalId: RENEWAL_ID, locale: "vi" } as const

const ARGS = { draftId: DRAFT_ID, renewalId: RENEWAL_ID }

/** The issue's answer of an invoice it issued. */
const issuedOf = (invoiceNo: string | null, state: string, issuedOn: string | null = "2026-11-13") =>
    misaOk({ outcome: "issued", provider: "misa_meinvoice", invoiceId: "misa-inv-0002", invoiceNo, state, issuedOn })

const NOTHING = { outcome: null, invoiceNo: null, invoiceId: null, state: null, issuedOn: null }

/**
 * `webbooks.invoice-issue` (Issue the invoice): the legal act, `TOOL.invoiceCreate` on the MISA meInvoice account (R57: the e-invoice
 * service issues, the CRM only records it after; a sandbox ACCOUNT replaces the dry run, R56), mode `ask`: the ONE invoice step a
 * person must sign, a tax document issued in the company's name, so every call waits for the owner's yes on an approval card. ONE tool
 * call and no AI: the renewal id goes with the draft id. The answer is the output: `issued` with the service's id, number (none yet is
 * kept as null), state and issue date (MISA's own `issuedOn`, null when it gave none). The owner who declines the issue made a decision: `declined` true (the graph tells the
 * team and ends `declined`). Any refusal of the e-invoice service (`rejected`, `not_found`, any other) is `context.fail` `cannot`
 * `invoice_issue_refused:<code>`: the tool declares no final refusal, so the engine stops the step for a person (Retry / Take over /
 * Skip, E-FIX12 A-1) and the node never turns it into an output. An answer with no known outcome stops the run too. Blocking.
 */
export const webbooksInvoiceIssueNode: TemplateNode = defineTemplateNode({
    id: "webbooks.invoice-issue",
    title: webbooksText("node.invoice-issue.title"),
    description: { vi: "Xuất hoá đơn chính thức từ bản nháp đã được duyệt.", en: "Issues the official invoice from the approved draft." },
    tools: [TOOL.invoiceCreate],
    mode: "ask",
    accounts: [PROVIDER.misaMeinvoice],
    input,
    output,
    run: async (given, ctx) => {
        const { draftId } = given
        if (draftId === null) return ctx.fail({ kind: "cannot", why: "no_draft_named" })
        const issued = await ctx.tools.call(TOOL.invoiceCreate, { draftId, renewalId: given.renewalId })
        if (!issued.ok && issued.declined === true) return { ...NOTHING, declined: true }
        // A refusal of the e-invoice service is a failed act: the engine stops the step for a person (E-FIX12 A-1); never an output.
        if (!issued.ok)
            return ctx.fail({ kind: "cannot", why: `invoice_issue_refused:${issued.refusal}` }, issued.facts)
        const text = (member: string): string | null => {
            const value = issued.value[member]
            return typeof value === "string" && value !== "" ? value : null
        }
        if (issued.value["outcome"] !== "issued" || text("invoiceId") === null)
            return ctx.fail({ kind: "cannot", why: "invoice_answered_incomplete" }, issued.value)
        return {
            outcome: "issued" as const,
            invoiceNo: text("invoiceNo"),
            invoiceId: text("invoiceId"),
            state: text("state"),
            issuedOn: text("issuedOn"),
            declined: false,
        }
    },
    examples: [
        {
            name: "issues the draft on the owner's yes: the number and the service's id as the issue answered them",
            params: {},
            input: GIVEN,
            tools: [{ id: TOOL.invoiceCreate, args: ARGS, answer: issuedOf("00000123", "issued") }],
            output: {
                outcome: "issued",
                invoiceNo: "00000123",
                invoiceId: "misa-inv-0002",
                state: "issued",
                issuedOn: "2026-11-13",
                declined: false,
            },
        },
        {
            name: "issued without a number yet: the number stays null",
            params: {},
            input: GIVEN,
            tools: [{ id: TOOL.invoiceCreate, args: ARGS, answer: issuedOf(null, "pending_number") }],
            output: {
                outcome: "issued",
                invoiceNo: null,
                invoiceId: "misa-inv-0002",
                state: "pending_number",
                issuedOn: "2026-11-13",
                declined: false,
            },
        },
        {
            name: "the e-invoice service rejects it: the step cannot go on, the engine stops it for a person",
            params: {},
            input: GIVEN,
            tools: [{ id: TOOL.invoiceCreate, args: ARGS, answer: refused("rejected", { message: "buyer tax id invalid" }) }],
            failure: { kind: "cannot", why: "invoice_issue_refused:rejected" },
        },
        {
            name: "the owner declines: nothing is issued, declined returned (the graph tells the team, ends declined)",
            params: {},
            input: GIVEN,
            tools: [{ id: TOOL.invoiceCreate, args: ARGS, answer: refused("declined") }],
            output: { ...NOTHING, declined: true },
        },
        {
            name: "a refusal the service gives (here not available) is the same: the node cannot go on",
            params: {},
            input: GIVEN,
            tools: [{ id: TOOL.invoiceCreate, args: ARGS, answer: refused("not_available") }],
            failure: { kind: "cannot", why: "invoice_issue_refused:not_available" },
        },
        {
            name: "no draft reached the step: nothing is issued, the node cannot go on",
            params: {},
            input: { ...GIVEN, draftId: null },
            failure: { kind: "cannot", why: "no_draft_named" },
        },
    ],
})
