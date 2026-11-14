import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { requireSoundFlow, templateFlowProblems } from "@modules/domain/agent-graphs/policies/flow.policy"
import { graphWithNodeSettings, unsettableRefusal } from "@modules/domain/agent-graphs/policies/node-settings.policy"
import { INSTALLED } from "@modules/domain/installed-plugins"
import { NUDGE_AGENT, NUDGE_GRAPH } from "@tests/fixtures/builders/node-settings-plugin.builder"
import { CONTACT, FRONT, WS, ZALO, customersSay, processOf, startThread, threadDbOf, type ThreadDb } from "./thread-world"

// NODE-SETTINGS, the exposing case's second half (`node-settings.spec.ts` holds the inbound half on the real front desk): a run that serves
// NO inbound account (a clock's nudge: no route woke it) sends on the step's CHOSEN account; with no choice the person's newest identity
// is taken, as before. The fixture's one step tells the person by their contact on a Zalo account (`node-settings-plugin.builder.ts`).

jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const fixture: typeof import("@tests/fixtures/builders/node-settings-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/node-settings-plugin.builder",
    )
    return { installed: parts.installationWith([fixture.NUDGE_PLUGIN], "node-settings") }
})

const ZALO_2 = "zalo-2"
/** A third Zalo account of the shop, attached to the agent, on which the person is NOT known. */
const ZALO_3 = "zalo-3"
const TEXT = "Mai shop co hang moi a."

/** The nudge as the install reads it: what an adopted workflow stores as its first version. */
const adopted = (): GraphSpec => {
    const graph = INSTALLED.templateOf(NUDGE_GRAPH)?.versions[0]?.graph
    if (graph === undefined) throw new Error(`no template ${NUDGE_GRAPH}`)
    return graph
}

/** The nudge with its step's accounts chosen (the door's write), stored as JSON. */
const chosen = (accounts: ReadonlyArray<string>): GraphSpec => {
    const written = graphWithNodeSettings(
        adopted(),
        "nudge",
        { accounts: accounts.map((connectionId) => ({ provider: "zalo_oa", connectionId })) },
        unsettableRefusal,
    )
    if (written === null) throw new Error("the choice changed nothing")
    const stored: GraphSpec = JSON.parse(JSON.stringify(written))
    return stored
}

/** The shop's second Zalo account, attached; the person is known on it too, by an OLDER identity than the first. */
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

/** Starts the nudge on `flow` (no route in its trigger: nothing inbound woke it) and answers the accounts the words went out on. */
const nudgedOn = async (flow: GraphSpec, third = false): Promise<ReadonlyArray<string | null>> => {
    const db = threadDbOf({ modules: { [FRONT]: NUDGE_AGENT } })
    const process = await processOf(db)
    await customersSay(process, [])
    secondAccount(db)
    if (third) {
        db.rights.accounts.push({ id: ZALO_3, provider: "zalo_oa" })
        db.rights.attachments.push({ agentId: FRONT, connectionId: ZALO_3, provider: "zalo_oa" })
    }
    const started = await startThread(process, {
        flow,
        versionId: `${NUDGE_GRAPH}@2`,
        workflowId: `wf:${NUDGE_GRAPH}`,
        trigger: { contactId: CONTACT, text: TEXT },
    })
    expect(started.error).toBeNull()
    return db.chat.ledger.rows.filter((row) => row.text === TEXT).map((row) => row.accountId)
}

describe("node settings: a run that serves no inbound account (a nudge)", () => {
    it("the copy with the step's accounts chosen is still the template's copy", () => {
        const copy = chosen([ZALO_2, ZALO])

        expect(templateFlowProblems(copy)).toEqual([])
        expect(() => requireSoundFlow(copy)).not.toThrow()
    })

    it("sends on the step's first chosen account, not the person's newest identity", async () => {
        await expect(nudgedOn(chosen([ZALO_2, ZALO]))).resolves.toEqual([ZALO_2])
    })

    it("a chosen account the person is not reached on names nothing: the next chosen one is taken", async () => {
        await expect(nudgedOn(chosen([ZALO_3, ZALO_2]), true)).resolves.toEqual([ZALO_2])
    })

    it("control: with no choice the person's newest identity is taken, as before", async () => {
        await expect(nudgedOn(adopted())).resolves.toEqual([ZALO])
    })
})
