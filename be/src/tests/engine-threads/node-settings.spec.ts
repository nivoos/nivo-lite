import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { AgentGraphsErrorCode } from "@modules/domain/agent-graphs/errors/agent-graphs.error"
import { GRAPH_TEMPLATE_EDITED, requireSoundFlow, templateFlowProblems } from "@modules/domain/agent-graphs/policies/flow.policy"
import { graphWithNodeSettings, unsettableRefusal } from "@modules/domain/agent-graphs/policies/node-settings.policy"
import {
    ANSWER,
    CONTACT,
    FRONT,
    UNDERSTAND,
    WS,
    ZALO,
    customersSay,
    frontDeskFlow,
    frontDeskVersion,
    processOf,
    runHeard,
    threadDbOf,
    type ThreadDb,
} from "./thread-world"

// NODE-SETTINGS (rule, engine words): a stored graph is exactly an installed template version except for the NODE SETTINGS a shop sets on
// a node step: its mode and which of the agent's attached accounts it uses, in try order. The call-time pick reads the step's choice
// AFTER the account the event came in on and the account the run already used, BEFORE the agent's default: so an inbound line is always
// answered on the account the person wrote to, whatever the step chose, and a run that serves no inbound account goes by the choice.
// Exposing kind: the front desk's reply step (`answer`) with a second Zalo account chosen first (this file: an inbound line); a run that
// serves no inbound account: `node-settings-nudge.spec.ts`. Second kind (a bank step): `node-settings-bank.spec.ts`.
// Real: the copy check (`requireSoundFlow`), the door's pure write (`graphWithNodeSettings`), the thread engine, the tool door, the node
// request read of the PINNED version, the account pick, the customer send's reach pick and the delivery ledger.

const ZALO_2 = "zalo-2"
const LINE = "Shop mo cua may gio?"
const REPLY = "Shop mo cua tu 8h den 21h a."

/** The front desk with the reply step's accounts chosen (the door's write), stored as JSON. */
const chosen = (accounts: ReadonlyArray<string>): GraphSpec => {
    const written = graphWithNodeSettings(
        frontDeskFlow(),
        "answer",
        { accounts: accounts.map((connectionId) => ({ provider: "zalo_oa", connectionId })) },
        unsettableRefusal,
    )
    if (written === null) throw new Error("the choice changed nothing")
    const stored: GraphSpec = JSON.parse(JSON.stringify(written))
    return stored
}

/** A second Zalo account of the shop, attached to the front desk, on which the person is known too (an OLDER identity than the first). */
const secondAccount = (db: ThreadDb): void => {
    db.rights.accounts.push({ id: ZALO_2, provider: "zalo_oa" })
    db.rights.attachments.push({ agentId: FRONT, connectionId: ZALO_2, provider: "zalo_oa" })
    db.chat.contacts.identities.push({
        id: "identity-zalo-2",
        workspaceId: WS,
        contactId: CONTACT,
        kind: "channel",
        provider: "zalo",
        account: ZALO_2,
        value: "zalo-user-2",
        verified: true,
        verifiedBy: "channel",
        source: "channel",
        joinedBy: null,
        at: "2026-10-01T00:00:00.000Z",
    })
}

/** The question route: understand routes to `answer`, whose agent searches once and answers. */
const scriptQuestion = (db: ThreadDb): void => {
    db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Lan: gio mo cua" } })
    db.model.script(ANSWER, { call: { tool: TOOL.brainSearch, args: { query: "gio mo cua" } } }, { done: { reply: REPLY } })
}

/** The accounts the reply went out on, as the delivery ledger keeps it. */
const repliedOn = (db: ThreadDb): ReadonlyArray<string | null> =>
    db.chat.ledger.rows.filter((row) => row.text === REPLY).map((row) => row.accountId)

describe("node settings: the accounts a reply step uses (exposing kind: the front desk's answer, two Zalo accounts)", () => {
    it("a copy with the reply step's accounts chosen is still the template's copy; any other change is still an edit", () => {
        const copy = chosen([ZALO_2, ZALO])

        expect(templateFlowProblems(copy)).toEqual([])
        expect(() => requireSoundFlow(copy)).not.toThrow()
        expect(copy.nodes.find((node) => node.key === "answer")?.accounts?.filter((entry) => entry.provider === "zalo_oa")).toEqual([
            { kind: expect.any(String), provider: "zalo_oa", connectionId: ZALO_2 },
            { kind: expect.any(String), provider: "zalo_oa", connectionId: ZALO },
        ])
        const edited: GraphSpec = {
            ...copy,
            nodes: copy.nodes.map((node) => (node.key === "answer" ? { ...node, params: { ...node.params, extra: 1 } } : node)),
        }
        expect(templateFlowProblems(edited)).toEqual([{ code: GRAPH_TEMPLATE_EDITED, at: expect.any(String) }])
        expect(() => requireSoundFlow(edited)).toThrow(expect.objectContaining({ code: AgentGraphsErrorCode.PublishRefused }))
    })

    it("an INBOUND line on the first account is answered on the first account, though the step chose the second first", async () => {
        const db = threadDbOf()
        const process = await processOf(db)
        await customersSay(process, [])
        secondAccount(db)
        db.versions.set(frontDeskVersion(db), { number: db.versions.get(frontDeskVersion(db))?.number ?? 1, flow: chosen([ZALO_2, ZALO]) })
        scriptQuestion(db)

        const wakes = await customersSay(process, [{ text: LINE, key: "m-in-1" }])
        const woken = await runHeard(process, wakes)

        expect(woken.error).toBeNull()
        expect(repliedOn(db)).toEqual([ZALO])
    })
})
