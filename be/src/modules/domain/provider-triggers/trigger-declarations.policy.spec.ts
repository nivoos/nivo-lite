import { z } from "zod"
import { bankTriggerOf, mailTriggerOf, renderTriggerOf } from "@tests/fixtures/builders/trigger-declaration.builder"
import { TriggerDeclarationsRegistry } from "./trigger-declarations.registry"
import {
    canCatchUpOf,
    declaredOf,
    onByDefaultOf,
    providerTriggerLookup,
    sampleDataOf,
    switchDeclarationOf,
    switchableOf,
    switchedOn,
    triggerDeciderOf,
    triggerInfoOf,
    triggerMembersOf,
    type SwitchedDeclaration,
} from "./trigger-declarations.policy"

const BANK = bankTriggerOf() as SwitchedDeclaration
const MAIL = mailTriggerOf() as SwitchedDeclaration
const RENDER = renderTriggerOf() as SwitchedDeclaration

/** A registry holding the fixtures plus one trigger that carries no switch (a customer channel's: on while its account is). */
const registryOf = (): TriggerDeclarationsRegistry => {
    const registry = new TriggerDeclarationsRegistry()
    registry.register(BANK, MAIL, RENDER, renderTriggerOf("creatomate"), {
        ...bankTriggerOf({ provider: "zalo_oa", name: "message.received" }),
        switch: undefined,
    })
    return registry
}

describe("the members of a declaration's data are derived from its schema", () => {
    it("lists the keys of the object with their JSON types, and a z.enum as a closed choice", () => {
        expect(triggerMembersOf(BANK.data)).toEqual([
            { name: "transactionId", type: "string", required: true, choices: [] },
            { name: "direction", type: "string", required: true, choices: ["in", "out"] },
        ])
    })

    it("marks an optional member as not required, reads a nullable member's type, and leaves a member of no stated type out", () => {
        const data = z.object({
            id: z.string(),
            amountVnd: z.number().int(),
            note: z.string().optional(),
            at: z.string().nullable(),
            anything: z.unknown(),
        })
        expect(triggerMembersOf(data)).toEqual([
            { name: "id", type: "string", required: true, choices: [] },
            { name: "amountVnd", type: "integer", required: true, choices: [] },
            { name: "note", type: "string", required: false, choices: [] },
            { name: "at", type: "string", required: true, choices: [] },
        ])
    })

    it("has no member for a schema that is no object", () => {
        expect(triggerMembersOf(z.string())).toEqual([])
    })

    it("samples every member: a placeholder of its type, the first value of a closed choice", () => {
        expect(sampleDataOf(BANK)).toEqual({ transactionId: "sample", direction: "in" })
        expect(sampleDataOf({ data: z.object({ n: z.number().int(), ok: z.boolean() }) })).toEqual({ n: 1, ok: true })
    })
})

describe("what a workflow that registers on a trigger is checked against", () => {
    // The event reaches MATCH as the generic scope of the one pipeline: its data members sit under `data` and a filter names
    // `data.<member>` of a closed choice (R44).
    it("supplies the generic scope with the declared members in `data`, and lets a filter compare a closed choice alone", () => {
        const info = triggerInfoOf(BANK)
        expect(info.supplies.map((param) => `${param.name}:${param.type}`)).toEqual([
            "eventId:string",
            "accountId:string",
            "data:object",
            "locale:string",
        ])
        expect(info.supplies.find((param) => param.name === "data")?.members).toEqual([
            { name: "transactionId", type: "string" },
            { name: "direction", type: "string" },
        ])
        expect(info.filterable).toEqual(["data.direction"])
    })

    it("has no filterable member where the data holds no closed choice", () => {
        expect(triggerInfoOf(MAIL).filterable).toEqual([])
    })

    it("looks a trigger up by its key and knows no other", () => {
        const registry = registryOf()
        expect(providerTriggerLookup("sepay:transaction.received", registry)).toEqual(triggerInfoOf(BANK))
        expect(providerTriggerLookup("sepay:refund.received", registry)).toBeUndefined()
    })
})

describe("the readers of a provider's declarations", () => {
    it("lists every declaration of a provider, and of those only the ones that carry an account switch as switchable", () => {
        const registry = registryOf()
        expect(declaredOf("zalo_oa", registry).map((declaration) => declaration.name)).toEqual(["message.received"])
        expect(switchableOf("zalo_oa", registry)).toEqual([])
        expect(switchableOf("sepay", registry).map((declaration) => declaration.name)).toEqual(["transaction.received"])
        expect(switchDeclarationOf("zalo_oa", "message.received", registry)).toBeNull()
        expect(switchDeclarationOf("sepay", "transaction.received", registry)).toBe(BANK)
        expect(switchDeclarationOf("sepay", "nothing", registry)).toBeNull()
    })

    it("keeps a switch off until someone turns it on, but for a trigger that reports work NIVO asked for", () => {
        expect(switchedOn(null, BANK)).toBe(false)
        expect(switchedOn(null, MAIL)).toBe(false)
        expect(switchedOn(null, RENDER)).toBe(true)
        expect(switchedOn({ enabled: false }, RENDER)).toBe(false)
        expect(switchedOn({ enabled: true }, BANK)).toBe(true)
        expect(switchedOn(null, null)).toBe(false)
    })

    it("answers a name on by default only when every switch-bearing declaration of the name says so", () => {
        const registry = registryOf()
        expect(onByDefaultOf("render.completed", registry)).toBe(true)
        expect(onByDefaultOf("transaction.received", registry)).toBe(false)
        expect(onByDefaultOf("nothing", registry)).toBe(false)
    })

    it("lets a switch catch up only where a poll also receives the trigger", () => {
        expect(canCatchUpOf(BANK)).toBe(true)
        expect(canCatchUpOf(MAIL)).toBe(true)
        expect(canCatchUpOf(RENDER)).toBe(false)
    })
})

describe("the one decider of an account trigger", () => {
    const AGENTS = ["core", "plugin", "other"]
    const CHOICES: ReadonlyArray<string | null> = [null, ...AGENTS]

    it("names at most one agent whatever is bound, so two deciders cannot exist", () => {
        for (const core of CHOICES) {
            for (const bound of CHOICES) {
                const decider = triggerDeciderOf(BANK, core, bound)
                expect(AGENTS.filter((agent) => agent === decider).length).toBeLessThanOrEqual(1)
                expect(decider).toBe(core ?? bound)
            }
        }
    })

    it("keeps the provider's core agent the decider while it is bound, and lets the owner's agent decide where no core agent is", () => {
        expect(triggerDeciderOf(BANK, "core", "plugin")).toBe("core")
        expect(triggerDeciderOf(BANK, null, "plugin")).toBe("plugin")
    })

    it("names nobody on a trigger nobody decides on", () => {
        expect(triggerDeciderOf(MAIL, "core", "plugin")).toBeNull()
    })
})
