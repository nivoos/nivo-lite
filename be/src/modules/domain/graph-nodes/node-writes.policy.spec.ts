import type { NodeHostPorts } from "@nivo-lite/agent-sdk/node"
import { EffectOutcomeUnknownCode, EffectOutcomeUnknownError } from "./errors/graph-nodes.error"
import { failureAfterWrites, writesNotedOf } from "./node-writes.policy"

// The tool facts the rule reads, declared per tool id here (the real catalogue is the tool-specs policy): `mutates`, `repeatable`, owner.
jest.mock("@modules/domain/tool-specs", () => {
    const actual: typeof import("@modules/domain/tool-specs") = jest.requireActual("@modules/domain/tool-specs")
    const facts: Readonly<Record<string, { mutates: boolean; repeatable: boolean; owner: string }>> = {
        "provider.write": { mutates: true, repeatable: false, owner: "some_provider" },
        "provider.send": { mutates: true, repeatable: true, owner: "some_provider" },
        "provider.read": { mutates: false, repeatable: false, owner: "some_provider" },
        "nivo.write": { mutates: true, repeatable: false, owner: actual.NIVO_OWNER },
    }
    return {
        ...actual,
        mutatesBySpec: (id: string) => facts[id]?.mutates,
        repeatableBySpec: (id: string) => facts[id]?.repeatable,
        ownersOfTool: (id: string) => (facts[id] === undefined ? [] : [facts[id].owner]),
    }
})

/** An answered call, as the host hands it back. */
const ANSWERED = { ok: true, value: { id: "x-1" }, via: { provider: "some_provider", connectionId: "c-1" } }

/** A refused call: no write happened. */
const REFUSED = { ok: false, refusal: "not_allowed", facts: {} }

/** Ports whose every call answers `answer`; `wrote` collects what the rule notes. */
const portsOf = (answer: unknown) => {
    const ports = {
        execute: jest.fn().mockResolvedValue(answer),
        callTool: jest.fn().mockResolvedValue(answer),
    } as unknown as NodeHostPorts
    const wrote: Array<string> = []
    return { noted: writesNotedOf(ports, wrote), wrote }
}

const callOf = (noted: NodeHostPorts, id: string, mutates?: boolean): Promise<unknown> =>
    noted.callTool({ id, ...(mutates === undefined ? {} : { mutates }) } as never, {}, `key-${id}`)

/** A node failure with a code of its own (a domain error's shape). */
const failure = (code: string): Error => Object.assign(new Error(`${code} happened`), { code })

describe("writesNotedOf + failureAfterWrites (ruling R79, rule Q-2)", () => {
    it("a provider-owned non-repeatable write answered, then a failure: tool_outcome_unknown naming the write, with `after`", async () => {
        const { noted, wrote } = portsOf(ANSWERED)
        await callOf(noted, "provider.write", true)

        const result = failureAfterWrites(failure("NODE_CANNOT"), wrote)

        expect(wrote).toEqual(["provider.write"])
        expect(result).toBeInstanceOf(EffectOutcomeUnknownError)
        expect(result).toMatchObject({
            code: EffectOutcomeUnknownCode.Tool,
            params: { effect: "provider.write", after: "NODE_CANNOT", why: "NODE_CANNOT happened" },
        })
    })

    it("an effect executed through `execute` counts the same way; the LAST write is named", async () => {
        const { noted, wrote } = portsOf(ANSWERED)
        await noted.execute({ id: "provider.write" } as never, {} as never, {} as never)
        await callOf(noted, "provider.write", true)

        const result = failureAfterWrites(new Error("plain throw"), wrote)

        expect(wrote).toEqual(["provider.write", "provider.write"])
        expect(result).toMatchObject({ code: EffectOutcomeUnknownCode.Tool, params: { effect: "provider.write", after: "failed" } })
    })

    it("a NIVO-owned write, a repeatable tool and a read leave the failure unchanged", async () => {
        const { noted, wrote } = portsOf(ANSWERED)
        await callOf(noted, "nivo.write", true)
        await callOf(noted, "provider.send", true)
        await callOf(noted, "provider.read", false)
        const cause = failure("NODE_CANNOT")

        expect(wrote).toEqual([])
        expect(failureAfterWrites(cause, wrote)).toBe(cause)
    })

    it("a refused write is no write: the failure stays as it was", async () => {
        const { noted, wrote } = portsOf(REFUSED)
        await callOf(noted, "provider.write", true)
        const cause = failure("NODE_CANNOT")

        expect(wrote).toEqual([])
        expect(failureAfterWrites(cause, wrote)).toBe(cause)
    })

    it("a failure that already is outcome-unknown stays unchanged, writes or not", () => {
        const cause = new EffectOutcomeUnknownError({ code: EffectOutcomeUnknownCode.Delivery, params: { effect: "provider.send" } })

        expect(failureAfterWrites(cause, ["provider.write"])).toBe(cause)
    })
})
