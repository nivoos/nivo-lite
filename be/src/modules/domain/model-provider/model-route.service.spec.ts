import { mock } from "@starci/jest-preset"
import type { ConnectionRecord, ConnectionsService } from "@modules/domain/connections"
import { ProviderRegistryErrorCode } from "@modules/domain/provider-registry"
import { withWorkStep } from "@modules/platform/logging"
import { sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import type { AiChatRequest, AiRunner } from "./model-provider.contracts"
import { ModelLiveRunnerService } from "./model-live-runner.service"
import { ModelProviderRegistryService } from "./model-provider-registry.service"
import { ModelRouteService } from "./model-route.service"
import { ModelSandboxRunnerService } from "./model-sandbox-runner.service"
import { MODEL_SANDBOX_CASE } from "./model-sandbox.catalogue"

const WS = "ws-1"

/** A connection row as `ConnectionsService.list` answers it; the provider key `model` is read as text until the union names it. */
const rowOf = (over: { readonly id: string; readonly provider: string; readonly sandbox: boolean; readonly status?: string }): ConnectionRecord =>
    mock<ConnectionRecord>({ workspaceId: WS, status: "connected", ...over } as Partial<ConnectionRecord>)

const CHAT: AiChatRequest = { messages: [], json: false, schema: null, timeoutMs: 1, context: null }

const endpoint = mock<AiRunner>()

const build = (rows: ReadonlyArray<ConnectionRecord>, on = true) => {
    const account = { id: "conn-model", workspaceId: WS, provider: "model", sandbox: true }
    const { sandbox } = on ? sandboxServiceOf(account) : sandboxServiceOff(account)
    const registry = new ModelProviderRegistryService()
    registry.register({ live: new ModelLiveRunnerService(), sandbox: new ModelSandboxRunnerService(sandbox) })
    // The store answers the rows of the provider asked, a disconnected (removed) one only when asked for.
    const list = jest.fn((_workspaceId: string, provider: string, options: { readonly includeDisconnected: boolean }) =>
        Promise.resolve(rows.filter((row) => row.provider === provider && (options.includeDisconnected || row.status !== "disconnected"))),
    )
    const connections = mock<ConnectionsService>({ listByProvider: list })
    return { route: new ModelRouteService(sandbox, connections, registry), list, sandbox, account, registry }
}

describe("ModelRouteService: a model call is served through the account of its workspace", () => {
    it("no sandbox model account: the endpoint itself (the implicit live account)", async () => {
        const t = build([rowOf({ id: "c1", provider: "sepay", sandbox: true })])
        await expect(t.route.runnerOf({ workspaceId: WS, purpose: "a:b" }, endpoint)).resolves.toBe(endpoint)
    })

    it("an open sandbox model account: its sandbox runner, logging the call under the call's purpose", async () => {
        const t = build([rowOf({ id: "conn-model", provider: "model", sandbox: true })])
        await t.sandbox.setNextCase(t.account, "call", MODEL_SANDBOX_CASE.timedOut)
        const runner = await t.route.runnerOf({ workspaceId: WS, purpose: "chatbot.answer:agent" }, endpoint)
        expect(runner).not.toBe(endpoint)
        await expect(runner.chat(CHAT)).rejects.toMatchObject({ name: "TimeoutError" })
        expect((await t.sandbox.calls(t.account)).map((one) => one.operation)).toEqual(["chatbot.answer:agent"])
    })

    it("a call with no purpose takes the open work scope's `<kind>:<step>` (a document's reading)", async () => {
        const t = build([rowOf({ id: "conn-model", provider: "model", sandbox: true })])
        await t.sandbox.setNextCase(t.account, "call", MODEL_SANDBOX_CASE.malformed)
        await withWorkStep("extract", "document_read", async () => {
            const runner = await t.route.runnerOf({ workspaceId: WS, purpose: null }, endpoint)
            await runner.chat(CHAT)
        })
        expect((await t.sandbox.calls(t.account)).map((one) => one.operation)).toEqual(["document_read:extract"])
    })

    it("a removed (disconnected) or live model row does not serve", async () => {
        const t = build([
            rowOf({ id: "m1", provider: "model", sandbox: true, status: "disconnected" }),
            rowOf({ id: "m2", provider: "model", sandbox: false }),
        ])
        await expect(t.route.runnerOf({ workspaceId: WS, purpose: null }, endpoint)).resolves.toBe(endpoint)
    })

    it("switch off: the endpoint, and NO account is read", async () => {
        const t = build([rowOf({ id: "conn-model", provider: "model", sandbox: true })], false)
        await expect(t.route.runnerOf({ workspaceId: WS, purpose: "a:b" }, endpoint)).resolves.toBe(endpoint)
        expect(t.list).not.toHaveBeenCalled()
    })

    it("a call that names no workspace: the endpoint, nothing read", async () => {
        const t = build([])
        await expect(t.route.runnerOf({ workspaceId: null, purpose: null }, endpoint)).resolves.toBe(endpoint)
        expect(t.list).not.toHaveBeenCalled()
    })

    it("a sandbox model account with NO sandbox registered is refused PROVIDER_SANDBOX_MISSING, never served live", async () => {
        const t = build([rowOf({ id: "conn-model", provider: "model", sandbox: true })])
        t.registry.register(new ModelLiveRunnerService())
        await expect(t.route.runnerOf({ workspaceId: WS, purpose: null }, endpoint)).rejects.toMatchObject({
            code: ProviderRegistryErrorCode.SandboxMissing,
        })
    })
})
