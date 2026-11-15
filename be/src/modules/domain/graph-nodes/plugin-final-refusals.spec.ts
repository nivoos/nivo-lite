import { Test } from "@nestjs/testing"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { defineEffect, defineTool, nodeIndexOf, type NodeHostPorts, type NodeInstall } from "@nivo-lite/agent-sdk/node"
import { mock } from "@starci/jest-preset"
import { z } from "zod"
import { EntityNodePortsService } from "@modules/domain/entity-engine"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { actRefusalOf, actRefusalsKeptOf } from "./act-refusals.policy"
import { GraphNodesErrorCode } from "./errors/graph-nodes.error"
import { finalRefusalOf } from "./final-refusal.policy"
import { GraphNodeRegistryService } from "./graph-node-registry.service"
import { GRAPH_NODES_OPTIONS } from "./graph-nodes.decorators"
import { missOfAnswer } from "./step-misses.policy"
import { finalRefusalConflictsOf } from "./tool-declarations.policy"

// SDK-DECL (E-FIX12 rule A-5, plugin side): a PLUGIN's tool or effect declares `finalRefusals` on its own definition; the engine reads it
// from the installed definition through the one reader (`finalRefusalOf`), exactly as it reads a core tool's spec. Two kinds of fixture:
// a chat-shaped write (a private plugin's line send) and a provider write (a private plugin's registration).
const shape = { title: { key: "t" }, args: z.object({ to: z.string().max(100) }), result: z.object({ id: z.string().max(100) }) }

const lineSend = defineTool({
    ...shape,
    id: "shop.line.send",
    mutates: true,
    refusals: ["opted_out", "window_closed"],
    finalRefusals: ["opted_out"],
})
const lineSendUndeclared = defineTool({ ...shape, id: "shop.line.push", mutates: true, refusals: ["opted_out", "window_closed"] })
const register = defineTool({
    ...shape,
    id: "registry.domain.register",
    mutates: true,
    refusals: ["already_exists", "rejected"],
    finalRefusals: ["already_exists"],
})
const renew = defineEffect({
    id: "registry.domain.renew",
    title: { key: "e" },
    payload: z.object({ domain: z.string().max(100) }),
    refusals: ["not_renewable", "rejected"],
    finalRefusals: ["not_renewable"],
})

const refused = (code: string): Record<string, unknown> => ({ ok: false, refusal: code, facts: {} })

describe("a plugin tool's declared final refusal is a business answer; the others stay a stop", () => {
    it("chat-shaped: the private line send's `opted_out` is no failed act; `window_closed` and an undeclared tool's `opted_out` are", () => {
        expect(actRefusalOf(lineSend.id, refused("opted_out"), lineSend.mutates, lineSend)).toBeNull()
        expect(actRefusalOf(lineSend.id, refused("window_closed"), lineSend.mutates, lineSend)).toMatchObject({
            code: GraphNodesErrorCode.ActRefused,
            params: { effect: lineSend.id, outsideRefusal: "window_closed" },
        })
        // Undeclared = a stop, whatever the code says: the engine never guesses a business answer.
        expect(actRefusalOf(lineSendUndeclared.id, refused("opted_out"), true, lineSendUndeclared)).toMatchObject({
            code: GraphNodesErrorCode.ActRefused,
        })
        // The same call read with no installed definition (an id no install holds) is a stop too.
        expect(actRefusalOf(lineSend.id, refused("opted_out"), true)).toMatchObject({ code: GraphNodesErrorCode.ActRefused })
    })

    it("a second kind, a provider write of a private plugin: `already_exists` (tool) and `not_renewable` (effect form) are answers; `rejected` stops", () => {
        expect(actRefusalOf(register.id, refused("already_exists"), true, register)).toBeNull()
        expect(actRefusalOf(register.id, refused("rejected"), true, register)).toMatchObject({ code: GraphNodesErrorCode.ActRefused })
        expect(actRefusalOf(renew.id, { kind: "refused", id: "not_renewable", facts: {} }, true, renew)).toBeNull()
        expect(actRefusalOf(renew.id, { kind: "refused", id: "rejected", facts: {} }, true, renew)).toMatchObject({
            code: GraphNodesErrorCode.ActRefused,
        })
    })

    it("the step's miss: a declared final refusal of a plugin tool is `refused` (the step's `unsuccessful` applies), any other is no miss", () => {
        expect(missOfAnswer(lineSend.id as never, refused("opted_out"), lineSend)).toEqual({
            kind: "refused",
            tool: lineSend.id,
            refusal: "opted_out",
        })
        expect(missOfAnswer(lineSend.id as never, refused("window_closed"), lineSend)).toBeNull()
        expect(missOfAnswer(register.id as never, refused("already_exists"), register)).toMatchObject({ kind: "refused" })
        expect(missOfAnswer(renew.id as never, { kind: "refused", id: "not_renewable" }, renew)).toMatchObject({ kind: "refused" })
    })

    it("ONE reader: a core tool answers from its spec, a plugin's from its definition, an id with neither declares none", () => {
        expect(finalRefusalOf(TOOL.customerMessageSend, "customer_opted_out")).toBe(true)
        expect(finalRefusalOf(lineSend.id, "opted_out", lineSend)).toBe(true)
        expect(finalRefusalOf(lineSend.id, "window_closed", lineSend)).toBe(false)
        expect(finalRefusalOf("shop.line.unknown", "opted_out")).toBe(false)
    })

    it("the ports keep a failed act of a plugin tool's refusal in `asks` and none for its declared final one, the answer reaching the node unchanged", async () => {
        const ports = mock<NodeHostPorts>()
        const final = refused("opted_out")
        const stop = refused("window_closed")
        ports.callTool.mockResolvedValueOnce(final).mockResolvedValueOnce(stop)
        const asks: Array<Error> = []
        const kept = actRefusalsKeptOf(ports, asks)
        await expect(kept.callTool(lineSend, { to: "a" }, "run:send:a")).resolves.toBe(final)
        expect(asks).toHaveLength(0)
        await expect(kept.callTool(lineSend, { to: "a" }, "run:send:b")).resolves.toBe(stop)
        expect(asks).toHaveLength(1)
        expect(asks[0]).toMatchObject({ code: GraphNodesErrorCode.ActRefused })
    })
})

describe("finalRefusalConflictsOf (boot gate)", () => {
    const indexOf = (install: Pick<NodeInstall, "tools" | "effects">) => nodeIndexOf({ nodes: [], dataKinds: [], ...install })

    it("a sound install has none: finals on private ids are fine", () => {
        expect(finalRefusalConflictsOf(indexOf({ tools: [lineSend, register], effects: [renew] }))).toEqual([])
    })

    it("names a plugin definition that declares finals over a core tool's own spec (two declarations of one tool)", () => {
        const twin = defineTool({ ...shape, id: TOOL.customerMessageSend, mutates: true, refusals: ["opted_out"], finalRefusals: ["opted_out"] })
        expect(finalRefusalConflictsOf(indexOf({ tools: [twin], effects: [] }))).toEqual([{ tool: TOOL.customerMessageSend, why: "over_spec" }])
    })

    it("names a definition that declares an outcome-unknown code final (that road is never a business answer), tool or effect", () => {
        const unknown = defineTool({
            ...shape,
            id: "shop.line.sync",
            mutates: true,
            refusals: ["tool_outcome_unknown"],
            finalRefusals: ["tool_outcome_unknown"],
        })
        const lost = defineEffect({
            id: "shop.line.lost",
            title: { key: "e" },
            payload: z.object({}),
            refusals: ["delivery_outcome_unknown"],
            finalRefusals: ["delivery_outcome_unknown"],
        })
        expect(finalRefusalConflictsOf(indexOf({ tools: [unknown], effects: [lost] }))).toEqual([
            { tool: "shop.line.sync", why: "outcome_unknown" },
            { tool: "shop.line.lost", why: "outcome_unknown" },
        ])
    })

    it("the registry refuses to start on one", async () => {
        const twin = defineTool({ ...shape, id: TOOL.customerMessageSend, mutates: true, refusals: ["opted_out"], finalRefusals: ["opted_out"] })
        const entityPorts = mock<EntityNodePortsService>()
        entityPorts.ports.mockReturnValue([])
        const compile = (): Promise<unknown> =>
            Test.createTestingModule({
                providers: [
                    GraphNodeRegistryService,
                    { provide: GRAPH_NODES_OPTIONS, useValue: { install: { nodes: [], effects: [], tools: [twin], dataKinds: [] } } },
                    { provide: LOGGER, useValue: mock<Logger>() },
                    { provide: EntityNodePortsService, useValue: entityPorts },
                ],
            }).compile()
        await expect(compile()).rejects.toMatchObject({
            code: GraphNodesErrorCode.FinalRefusalConflict,
            params: { tool: TOOL.customerMessageSend, why: "over_spec" },
        })
    })
})
