import { Test } from "@nestjs/testing"
import { bankTriggerOf, mailTriggerOf, renderTriggerOf } from "@tests/fixtures/builders/trigger-declaration.builder"
import { namedAgentsOf, triggerStatesOf } from "./provider-trigger-states.policy"
import { canCatchUpOf, type SwitchedDeclaration } from "./trigger-declarations.policy"

const SUBJECT = Symbol("provider-trigger-states.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { namedAgentsOf, triggerStatesOf } }],
    }).compile()
    return moduleRef.get<typeof import("./provider-trigger-states.policy")>(SUBJECT)
}

/** The fixtures that carry a switch, as the states read them. */
const BANK = bankTriggerOf() as SwitchedDeclaration
const MAIL = mailTriggerOf() as SwitchedDeclaration
const RENDER = renderTriggerOf() as SwitchedDeclaration

describe("provider-trigger-states.policy", () => {
    it("lets a switch catch up only where a poll also receives the trigger", () => {
        expect(canCatchUpOf(BANK)).toBe(true)
        expect(canCatchUpOf(MAIL)).toBe(true)
        // A render completion is received by its webhook alone: the run that waits for it reads the render's status.
        expect(canCatchUpOf(RENDER)).toBe(false)
    })

    it("offers the attached agents the directory knows as choices, and none while a core agent decides", async () => {
        const policy = await build()
        const names = new Map([
            ["core", "Accounting"],
            ["plugin", "Renewals"],
        ])
        const facts = { connectionId: "conn-1", declared: [BANK], switches: [], attached: ["plugin", "gone"], names }

        const [free] = policy.triggerStatesOf({ ...facts, coreDeciders: {} })
        const [held] = policy.triggerStatesOf({ ...facts, coreDeciders: { "transaction.received": "core" } })

        expect(free).toMatchObject({ enabled: false, deciderAgentId: null, coreDecides: false })
        expect(free?.deciderChoices).toEqual([{ agentId: "plugin", name: "Renewals" }])
        expect(held).toMatchObject({ deciderAgentId: "core", deciderAgentName: "Accounting", coreDecides: true, deciderChoices: [] })
    })

    it("gives every state its short title `<source> · <event>` from the declaration's words, and the ways it is received", async () => {
        const policy = await build()

        for (const declaration of [BANK, MAIL, RENDER]) {
            expect(declaration.words.title.vi).toMatch(/^.+ · .+$/u)
            expect(declaration.words.title.en).toMatch(/^.+ · .+$/u)
        }
        const states = policy.triggerStatesOf({
            connectionId: "conn-1",
            declared: [BANK, MAIL, RENDER],
            switches: [],
            attached: [],
            names: new Map(),
            coreDeciders: {},
        })
        expect(states[0]?.title).toEqual({ vi: "Ngân hàng · tiền vào tài khoản", en: "Bank · money received" })
        expect(states.map((state) => state.via)).toEqual([["webhook", "poll"], ["poll"], ["webhook"]])
        expect(states.map((state) => state.withoutPoll?.source ?? null)).toEqual([null, null, "nivo:wait-timeout"])
        expect(states[2]?.withoutPoll?.reason.en).toMatch(/waiting run/u)
    })

    it("names every agent a state may name once: core and bound deciders and the attached agents", async () => {
        const policy = await build()
        const switches = [
            { name: "a", enabled: true, enabledAt: null, lastFiredAt: null, firedCount: 0, deciderAgentId: "plugin" },
        ]

        expect(policy.namedAgentsOf({ switches, coreDeciders: { a: "core", b: null }, attached: ["plugin", "reader"] })).toEqual([
            "core",
            "plugin",
            "reader",
        ])
    })
})
