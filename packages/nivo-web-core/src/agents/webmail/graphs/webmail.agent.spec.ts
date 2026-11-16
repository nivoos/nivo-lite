import { PROVIDER, TRIGGER } from "@nivo-lite/agent-sdk/names"
import {
    type TemplateGraph,
    type TemplateTriggerLookup,
    templateAgentProblems,
    templateGraphProblems,
} from "@nivo-lite/agent-sdk/template"
import { webmailTeamChatGraph } from "./team-chat.graph"
import { webmailTriageGraph } from "./triage.graph"
import { webmailAgent } from "./webmail.agent"

/** The engine's trigger lookup as this spec assumes it (ruling B5): a mail is a person's line, the generic scope of a channel message; a call what it maps. */
const triggers: TemplateTriggerLookup = {
    supplies: (verb) => {
        if (verb === TRIGGER.workflowCalled) return { kind: "caller" }
        if (verb === TRIGGER.mailMessageReceived) {
            return {
                kind: "fixed",
                params: [
                    { name: "eventId", type: "string" },
                    { name: "accountId", type: "string" },
                    { name: "contactId", type: "string" },
                    { name: "routeId", type: "string" },
                    { name: "subject", type: "object" },
                    { name: "data", type: "object" },
                ],
            }
        }
        return { kind: "unknown" }
    },
}

/** A graph's steps by key, each with its kind and, for a node step, its node id. */
const stepsOf = (graph: TemplateGraph): ReadonlyArray<readonly [string, string]> =>
    graph.spec.nodes.map((step) => [step.key, step.kind === "node" ? step.step : step.kind] as const)

/** One step of a graph by key. */
const stepOf = (graph: TemplateGraph, key: string): (typeof graph.spec.nodes)[number] | undefined =>
    graph.spec.nodes.find((step) => step.key === key)

/** `expect.objectContaining` as the `unknown` a matcher slot takes. */
const objectLike = (shape: Record<string, unknown>): unknown => expect.objectContaining(shape)

describe("the Mailbox agent template", () => {
    it("loads with no problem, its graphs judged with its providers and the supplies of its triggers", () => {
        expect(templateAgentProblems(webmailAgent, { triggers })).toEqual([])
        for (const graph of webmailAgent.graphs) {
            expect(
                templateGraphProblems(graph.spec, {
                    nodes: graph.nodes,
                    agentAccounts: webmailAgent.accounts,
                    triggers,
                    nullability: "strict",
                }),
            ).toEqual([])
        }
    })

    it("attaches the mailbox (ONE account: smtp with its inbound half) only; the triage is primary", () => {
        expect(webmailAgent.key).toBe("webmail")
        expect(webmailAgent.accounts).toEqual([PROVIDER.imap, PROVIDER.smtp])
        expect(webmailAgent.graphs.map((graph) => graph.key)).toEqual(["webmail.triage", "webmail.team-chat"])
        expect(webmailAgent.primary).toBe("webmail.triage")
        // ledger 2026-11-13 (`nivo-frame.rights`): every graph's catalogue version + 1 (one mode per node changed every compiled document).
        // 2026-11-14 (R68): the triage + 1, its conditions, loop and outcomes carry the workspace's words (labels; business unchanged).
        // 2026-11-14 (WEBCORE-6, a person's mail is a line like a chat message): the triage 7 -> 8 (no clock round, no batch read: `hear`).
        // 2026-11-15 (WEBCORE-7): the triage 8 -> 9 (the mail trigger is listed on `smtp`, the mailbox account kind).
        expect(webmailTriageGraph.spec.catalogue?.version).toBe(9)
        // 2026-11-14 (EF-G, `rights` 11c): the chat turn + 1 (a declined answer post ends the turn `declined`).
        expect(webmailTeamChatGraph.spec.catalogue?.version).toBe(5)
    })
})

describe("webmail.triage", () => {
    it("wakes on a person's mail to a mailbox (as a chat graph on a message), open to the agent only", () => {
        // Ledger (owner key triggerOneSource2026_11_12, CORRECTED 2026-11-12: one source per STREAM): `account: x` -> `accounts: [x]`; the
        // provider listed once means EVERY attached mailbox is a source (cto@, ketoan@, support@: three streams, three sources).
        // WEBCORE-6 (MAIL-IN): the mailbox is ONE account, `smtp` with its inbound half; the 15-minute clock round is gone.
        expect(webmailTriageGraph.spec.triggers).toEqual([{ verb: TRIGGER.mailMessageReceived, accounts: [PROVIDER.smtp] }])
        expect(webmailTriageGraph.spec.entry.openTo).toBe("agent")
    })

    it("hears the person's mails as one mail, sorts it and routes it: four hand-offs that end the run, a team report, or nothing", () => {
        expect(stepsOf(webmailTriageGraph)).toEqual(
            expect.arrayContaining([
                ["hear", "webmail.hear"],
                ["sort", "webmail.sort"],
                ["to-renewals", "call-workflow"],
                ["to-tickets", "call-workflow"],
                ["to-invoices", "call-workflow"],
                ["to-enquiries", "call-workflow"],
                ["report", "webmail.sorted-report"],
                ["report-declined", "if"],
                ["told", "outcome"],
                ["nothing", "outcome"],
                ["declined", "outcome"],
            ]),
        )
        expect(webmailTriageGraph.spec.nodes).toHaveLength(11)
        expect(webmailTriageGraph.spec.outcomes.map((outcome) => outcome.key).sort()).toEqual(["declined", "nothing", "told"])
        const sort = stepOf(webmailTriageGraph, "sort")
        expect(sort?.kind === "node" ? sort.routes : null).toEqual({
            "renewal-reply": "to-renewals",
            ticket: "to-tickets",
            "supplier-invoice": "to-invoices",
            enquiry: "to-enquiries",
            "needs-person": "report",
            other: "nothing",
        })
    })

    it("a declined team report ends declined with no notice (the declined write is itself a team post)", () => {
        const report = stepOf(webmailTriageGraph, "report")
        expect(report?.kind === "node" ? report.next : undefined).toBe("report-declined")
        const check = stepOf(webmailTriageGraph, "report-declined")
        expect(check?.kind).toBe("if")
        if (check?.kind !== "if") return
        expect(check.params.when).toEqual({
            op: "eq",
            ref: objectLike({ $ref: "steps.report.output.declined" }),
            value: true,
        })
        expect(check.routes.yes).toBe("declined")
        expect(check.routes.no).toBe("told")
    })

    it("hands the sorted mail to the agent that handles its kind; a call that answers by mail carries the person's route", () => {
        const calls = ["to-renewals", "to-tickets", "to-invoices", "to-enquiries"].map((key) => {
            const call = stepOf(webmailTriageGraph, key)
            return call?.kind === "call-workflow"
                ? [call.params.agent, call.params.workflow, Object.keys(call.params.inputs), call.next ?? null]
                : null
        })
        expect(calls).toEqual([
            ["webrenew", "mail-replies", ["mails"], null],
            ["webdesk", "mail-tickets", ["mails", "routeId"], null],
            ["webbooks", "supplier-invoices", ["mails"], null],
            ["websales", "mail-enquiries", ["mails", "routeId"], null],
        ])
    })
})

describe("webmail.team-chat", () => {
    it("is the shared chat turn with blocks-core's own answer turn", () => {
        expect(webmailTeamChatGraph.key).toBe("webmail.team-chat")
        expect(webmailTeamChatGraph.spec.triggers).toEqual([{ verb: TRIGGER.workflowCalled }])
        expect(stepsOf(webmailTeamChatGraph)).toEqual(
            expect.arrayContaining([
                ["answer", "team.chat"],
                ["has-proposal", "if"],
                ["propose", "team.truth-propose"],
                ["post", "team.answer-post"],
                ["post-declined", "if"],
                ["declined", "outcome"],
            ]),
        )
    })
})

describe("the webmail catalogues' seedActive", () => {
    it("mirrors the old JSON template of every graph: active at seed exactly where the JSON said `seedActive: true`", () => {
        const seeded = webmailAgent.graphs.map(
            (graph) => [graph.key, graph.spec.catalogue?.seedActive === true] as const,
        )
        expect([...seeded].sort(([a], [b]) => a.localeCompare(b))).toEqual([
            ["webmail.team-chat", true],
            ["webmail.triage", false],
        ])
    })
})
