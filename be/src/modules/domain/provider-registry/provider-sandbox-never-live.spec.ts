import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { FakeClock, mock } from "@starci/jest-preset"
import type { AgentDirectoryService } from "@modules/domain/agents"
import type { AgentRunsService } from "@modules/domain/agent-runs"
import type { ConnectionBindingsReadService, ConnectionRecord, ConnectionsService } from "@modules/domain/connections"
import type { NodeToolCall } from "@modules/domain/graph-nodes"
import { PaymentRequestNativeService } from "@modules/domain/payment-tools/payment-request-native.service"
import type { ToolCallLogService } from "@modules/domain/tool-call-log"
import type { AccountAttachmentsService, ProviderAttachmentView } from "@modules/domain/tool-grants"
import { AgentAccountsService, ToolRunnerService, ToolsErrorCode } from "@modules/domain/tools"
import type { NodeRequestsGate, OptionalNodeRequest } from "@modules/domain/tools/node-mode.policy"
import type { Logger } from "@modules/platform/logging"
import { ProviderRegistryErrorCode } from "./errors/provider-registry.error"
import { PaymentRequestRegistryService } from "./payment-request-registry.service"
import type { PaymentRequestPort } from "./payment-request-ports.contracts"
import { ProviderRegistryService } from "./provider-registry.service"

/*
 * THE GUARD THAT A SANDBOX ACCOUNT NEVER REACHES A LIVE IMPLEMENTATION (owner rulings R56 + R59, lane concept provider-sandbox rule 2):
 * `portFor(account)` is THE ONE SWITCH. For EVERY registry of the source (every `class X extends ProviderRegistryService<...>`, found by
 * reading the sources, so a new registry is covered the day it lands) a sandbox account is answered by the sandbox port or refused, never
 * by the live instance, whatever was registered and in whatever order; and no registry overrides the switch.
 */

/** The domain folder the registries live in. */
const DOMAIN = join(__dirname, "..")

/** Every non-spec TypeScript source under a folder. */
const sourcesOf = (folder: string): ReadonlyArray<string> =>
    readdirSync(folder).flatMap((name) => {
        const path = join(folder, name)
        if (statSync(path).isDirectory()) return sourcesOf(path)
        return name.endsWith(".ts") && !name.endsWith(".spec.ts") ? [path] : []
    })

/** One registry of the source: its class name, the file that declares it, and its class. */
interface RegistryClass {
    readonly name: string
    readonly file: string
    readonly ctor: new () => ProviderRegistryService<{ readonly provider: string }>
}

/** The registries: every class that extends `ProviderRegistryService`, loaded from the file that declares it. */
const registriesOf = (): ReadonlyArray<RegistryClass> =>
    sourcesOf(DOMAIN).flatMap((file) => {
        const names = [...readFileSync(file, "utf8").matchAll(/class (\w+) extends ProviderRegistryService</g)].map((match) => match[1] ?? "")
        if (names.length === 0) return []
        const loaded: Record<string, unknown> = require(file)
        return names.map((name) => ({ name, file, ctor: loaded[name] as RegistryClass["ctor"] }))
    })

/** A port double: it only carries its provider key and a label that says which implementation it is. */
const portOf = (provider: string, kind: "live" | "sandbox") => ({ provider, kind })

describe("provider sandbox is never answered by a live implementation, for every registry", () => {
    const registries = registriesOf()

    it("reads the real registries of the source (a new registry joins the guard by existing)", () => {
        const names = registries.map((one) => one.name)

        expect(registries.length).toBeGreaterThanOrEqual(20)
        expect(new Set(names).size).toBe(names.length)
        expect(names).toEqual(expect.arrayContaining(["CustomerSendRegistryService", "DomainRegistrarRegistryService", "InvoiceIssueRegistryService"]))
        expect(registries.every((one) => typeof one.ctor === "function")).toBe(true)
    })

    it.each(registries.map((one) => [one.name, one] as const))("%s: a sandbox account is answered by the sandbox port, never the live instance, whatever the registration order", (_name, { ctor }) => {
        const registry = new ctor()
        const live = portOf("p1", "live")
        const sandbox = portOf("p1", "sandbox")

        registry.register({ live, sandbox })

        expect(registry.portFor({ provider: "p1", sandbox: true })).toBe(sandbox)
        expect(registry.portFor({ provider: "p1", sandbox: true })).not.toBe(live)
        expect(registry.portFor({ provider: "p1", sandbox: false })).toBe(live)
        expect(registry.liveOf("p1")).toBe(live)

        const again = portOf("p1", "live")
        registry.register(again)
        expect(() => registry.portFor({ provider: "p1", sandbox: true })).toThrow(expect.objectContaining({ code: ProviderRegistryErrorCode.SandboxMissing }))
        expect(registry.portFor({ provider: "p1", sandbox: false })).toBe(again)
    })

    it.each(registries.map((one) => [one.name, one] as const))("%s: a provider that registered only a live port refuses a sandbox account with PROVIDER_SANDBOX_MISSING and never answers the live one", (_name, { ctor }) => {
        const registry = new ctor()
        const live = portOf("p2", "live")
        registry.register(live)

        let answered: unknown = "not asked"
        try {
            answered = registry.portFor({ provider: "p2", sandbox: true })
        } catch (cause) {
            expect(cause).toMatchObject({ code: ProviderRegistryErrorCode.SandboxMissing, params: { provider: "p2" } })
            answered = "refused"
        }

        expect(answered).toBe("refused")
        expect(registry.portFor({ provider: "p2", sandbox: false })).toBe(live)
    })

    it.each(registries.map((one) => [one.name, one] as const))("%s: a sandbox account of a provider nobody registered is refused, and a live one answers undefined", (_name, { ctor }) => {
        const registry = new ctor()

        expect(() => registry.portFor({ provider: "nobody", sandbox: true })).toThrow(expect.objectContaining({ code: ProviderRegistryErrorCode.SandboxMissing }))
        expect(registry.portFor({ provider: "nobody", sandbox: false })).toBeUndefined()
    })

    it("refuses a sandbox twin that names another provider than its live one", () => {
        const [first] = registries
        const registry = new (first as RegistryClass).ctor()

        expect(() => registry.register({ live: portOf("a", "live"), sandbox: portOf("b", "sandbox") })).toThrow(
            expect.objectContaining({ code: ProviderRegistryErrorCode.SandboxMismatch }),
        )
    })

    it("no registry overrides the one switch: portFor, liveOf and register are the base class's alone", () => {
        const overrides = registries.flatMap(({ name, ctor }) =>
            ["portFor", "liveOf", "register"].filter((member) => Object.prototype.hasOwnProperty.call(ctor.prototype, member)).map((member) => `${name}.${member}`),
        )

        expect(overrides).toEqual([])
    })
})

/*
 * THE ACCOUNT HALF OF "NEVER LIVE" (SAFE-PICK, RESTART-R9 incident 2026-11-15). The guard above proves a SANDBOX ACCOUNT never reaches a
 * live port; it said nothing of WHICH account a run's call is handed. On dev a sale run started (through a workflow call) by a SANDBOX
 * Zalo line was handed the shop's LIVE payOS account by its node settings ([live, sandbox]) and made a real payment link: every port
 * answered right for the account it was given. Lane concept provider-sandbox rule 19 (ONE WORLD PER RUN) is the account half; the ONE reproduction below drives the incident from
 * the runner down to the payment request registry: the live port records ZERO calls.
 */

const WS_ID = "ws-safe"
const AGENT = "agent-sales"
const STEP_REF = { nodeKey: "request-pay", versionId: "v-7", workflowId: "wf-consult" }
const CALLED_RUN = { runId: "run-sale" }

/** One stored run: its trigger's account and the run that called it (the wake's plain data, as `core.call-workflow` writes it). */
interface StoredRun {
    readonly trigger?: string
    readonly caller?: string
    readonly used?: ReadonlyArray<string>
}

/** The pick over a shop: its attachments, which accounts are SANDBOX ones, the step's node request and the runs of the chain. */
const pickOf = (
    rows: ReadonlyArray<ProviderAttachmentView>,
    sandbox: ReadonlyArray<string>,
    request: OptionalNodeRequest,
    runs: Readonly<Record<string, StoredRun>>,
): AgentAccountsService => {
    const attachments = mock<AccountAttachmentsService>()
    attachments.listOfAgent.mockResolvedValue([...rows])
    const connections = mock<ConnectionBindingsReadService>()
    connections.factsOf.mockImplementation((ids) =>
        Promise.resolve(
            ids.map((id) => ({ id, provider: "", name: id, status: "connected", createdAt: new Date(0), sandbox: sandbox.includes(id), botUsername: null, accountMasked: null })),
        ),
    )
    connections.recordOf.mockResolvedValue(null)
    const gate = mock<NodeRequestsGate>()
    gate.requestOf.mockResolvedValue(request)
    const reader = mock<AgentRunsService>()
    reader.runOf.mockImplementation((_workspaceId, runId) => {
        const run = runs[runId]
        if (run === undefined) return Promise.resolve(null)
        const context = {
            ...(run.trigger === undefined ? {} : { connectionId: run.trigger }),
            ...(run.caller === undefined ? {} : { tagContext: JSON.stringify({ caller: { runId: run.caller } }) }),
        }
        return Promise.resolve({ id: runId, workspaceId: WS_ID, agentId: AGENT, wakeId: `wake-${runId}`, trigger: "t", versionId: null, status: "running", context, errorCode: null, spoken: false })
    })
    const log = mock<ToolCallLogService>()
    log.connectionsUsedByRun.mockImplementation((_workspaceId, runId) => Promise.resolve(runs[runId]?.used ?? []))
    return new AgentAccountsService(attachments, mock<AgentDirectoryService>(), connections, gate, undefined, log, reader, mock<Logger>())
}

const attached = (connectionId: string, provider: string, isDefault = false): ProviderAttachmentView => ({
    agentId: AGENT,
    connectionId,
    provider,
    isDefault,
})

describe("never live, the incident (RESTART-R9): the pay step of a sale CALLED from a sandbox line, settings [live, sandbox]", () => {
    /** A payment request port double that counts its calls. */
    const portOf = (provider: string, world: "live" | "sandbox") => {
        const calls: Array<string> = []
        const port: PaymentRequestPort = {
            provider,
            create: (connection, ask) => {
                calls.push(connection.id)
                return Promise.resolve({ amountVnd: ask.amountVnd, reference: ask.reference, status: "open", payKey: `${world}-1`, payUrl: `https://${world}.invalid/pay` })
            },
        }
        return { port, calls }
    }
    const recordOf = (id: string, provider: string, sandbox: boolean): ConnectionRecord =>
        Object.assign(mock<ConnectionRecord>(), { id, workspaceId: WS_ID, provider, name: id, status: "connected", sandbox })

    /** The runner of the app over the REAL pick and the REAL payment family; the payOS registry holds a live and a sandbox double. */
    const runnerOver = (pick: AgentAccountsService) => {
        const live = portOf("payos", "live")
        const sandbox = portOf("payos", "sandbox")
        const registry = new PaymentRequestRegistryService()
        registry.register({ live: live.port, sandbox: sandbox.port })
        const connections = mock<ConnectionsService>()
        connections.find.mockImplementation((_workspaceId, id) =>
            Promise.resolve(id === "pay-live" ? recordOf(id, "payos", false) : id === "pay-sbx" ? recordOf(id, "payos", true) : null),
        )
        const family = new PaymentRequestNativeService(connections, registry)
        const runner = new ToolRunnerService({
            door: {
                call: (call: NodeToolCall) =>
                    family.invoke(WS_ID, "payment.request.create", call.args, {
                        agentId: AGENT,
                        conversationId: null,
                        connectionId: call.account?.connectionId,
                        provider: call.account?.provider,
                    }),
                effectRight: () => Promise.resolve(null),
            },
            registry: { executorOf: () => undefined },
            ledger: { once: (_ws, _effect, _call, act) => act() },
            accounts: pick,
            leads: null,
            clock: new FakeClock(new Date("2026-11-14T23:51:48.000Z")),
            logger: mock<Logger>(),
        })
        const run = () =>
            runner.run({
                road: "tool",
                token: "tok",
                tool: "nivo.tool.payment.request.create",
                args: { amountVnd: 350000, reference: "DH-20261115-0040" },
                key: "run-sale:request-pay:1",
                approval: null,
                turn: { turnId: CALLED_RUN.runId, workspaceId: WS_ID, agentId: AGENT, subject: null, conversationId: "conv-1", locale: "vi" },
                workflowStep: STEP_REF,
            })
        return { run, live, sandbox }
    }
    /** The pay step as the shop's standard stores it on dev: payOS live then sandbox, then SePay (no account chosen). */
    const PAY_NODE: OptionalNodeRequest = {
        mode: "auto",
        accounts: [
            { kind: "payment", provider: "payos", connectionId: "pay-live" },
            { kind: "payment", provider: "payos", connectionId: "pay-sbx" },
            { kind: "payment", provider: "sepay", connectionId: null },
        ],
    }
    /** Dev's chain: the front desk's run woken on the SANDBOX Zalo line calls the sale; the sale's own context names no account. */
    const CHAIN = { "run-sale": { caller: "run-desk" }, "run-desk": { trigger: "zalo-sbx" } }

    it("the request goes through the SANDBOX payOS; the LIVE port records ZERO calls", async () => {
        const rows = [attached("pay-live", "payos"), attached("pay-sbx", "payos"), attached("zalo-sbx", "zalo_oa"), attached("sepay-sbx", "sepay", true)]
        const { run, live, sandbox } = runnerOver(pickOf(rows, ["pay-sbx", "zalo-sbx", "sepay-sbx"], PAY_NODE, CHAIN))

        const answer = await run()

        expect(answer).toMatchObject({ road: "tool", via: { provider: "payos", connectionId: "pay-sbx" } })
        expect(live.calls).toEqual([])
        expect(sandbox.calls).toEqual(["pay-sbx"])
    })

    it("with only the LIVE payOS attached (no SePay): refused TOOLS_ACCOUNT_OTHER_WORLD; the LIVE port records ZERO calls", async () => {
        const rows = [attached("pay-live", "payos"), attached("zalo-sbx", "zalo_oa")]
        const { run, live, sandbox } = runnerOver(pickOf(rows, ["zalo-sbx"], PAY_NODE, CHAIN))

        await expect(run()).rejects.toMatchObject({ code: ToolsErrorCode.AccountOtherWorld, params: { provider: "payos", world: "sandbox" } })
        expect(live.calls).toEqual([])
        expect(sandbox.calls).toEqual([])
    })
})
