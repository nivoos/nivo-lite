import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { AccountDataAdmissionsService, AccountDataIntakeService } from "@modules/domain/account-data"
import { ConnectionBindingsReadService, ConnectionsService, type ConnectionRecord } from "@modules/domain/connections"
import { CREATOMATE_SANDBOX_CATALOGUE } from "@modules/domain/creatomate-provider/creatomate-sandbox.catalogue"
import { CreatomateSandboxComposeService } from "@modules/domain/creatomate-provider/creatomate-sandbox-compose.service"
import { JSON2VIDEO_SANDBOX_CATALOGUE } from "@modules/domain/json2video-provider/json2video-sandbox.catalogue"
import { Json2VideoSandboxComposeService } from "@modules/domain/json2video-provider/json2video-sandbox-compose.service"
import { proofOf } from "@modules/domain/provider-registry"
import type { SandboxCatalogue } from "@modules/domain/provider-sandbox"
import { SHOTSTACK_SANDBOX_CATALOGUE } from "@modules/domain/shotstack-provider/shotstack-sandbox.catalogue"
import { ShotstackSandboxComposeService } from "@modules/domain/shotstack-provider/shotstack-sandbox-compose.service"
import { ToolsErrorCode, type NativeCaller } from "@modules/domain/tools"
import { VideoComposeRegistryService, VideoRenderIntakeService } from "@modules/domain/video-compose"
import type { RenderDoorDelivery, VideoComposePort } from "@modules/domain/video-compose/video-compose.contracts"
import { VIDEO_COMPOSE_TOOL, VideoComposeNativeService } from "@modules/domain/video-compose/video-compose.service"
import { VideoRenderAdmissionService } from "@modules/domain/video-compose/video-render-admission.service"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { isRecord } from "@modules/platform/primitives"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { causeFactsOf, causeParamsOf } from "@tests/fixtures/builders/cause-facts.builder"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { SOUND_SPEC } from "@tests/fixtures/builders/video-compose.builder"

/*
 * THE SECOND KIND of the SBX standard for the compose providers (SBX-MEDIA): the situations the three compose sandboxes answer, proven
 * through the DOORS that consume them, never through the sandbox service alone: the generic compose tools (`video.compose`,
 * `video.render.get`: what a node's step calls, whose runner falls back on a `not_sent` proof) and the render door's intake (what the
 * provider's callback reaches). One table, three providers: a situation that holds for one holds for each.
 */

interface Row {
    readonly key: string
    readonly catalogue: SandboxCatalogue
    readonly make: (sandbox: ReturnType<typeof sandboxServiceOf>["sandbox"]) => VideoComposePort
    /** The case ids of the situations, as the provider's catalogue names them. */
    readonly ids: {
        readonly refused: string
        readonly auth: string
        readonly limited: string
        readonly silent: string
        readonly unknownApplied: string
        readonly never: string
        readonly fails: string
        readonly readDefault: string
        readonly readLimited: string
        readonly readSilent: string
        readonly callbackDone: string
        readonly callbackNotALine: string
        readonly callbackMalformed: string
        readonly callbackNeverStarted: string
    }
}

const ROWS: ReadonlyArray<Row> = [
    {
        key: "creatomate",
        catalogue: CREATOMATE_SANDBOX_CATALOGUE,
        make: (sandbox) => new CreatomateSandboxComposeService(sandbox),
        ids: {
            refused: "CREATOMATE-3", auth: "CREATOMATE-9", limited: "CREATOMATE-10", silent: "CREATOMATE-11", unknownApplied: "CREATOMATE-4",
            never: "CREATOMATE-8", fails: "CREATOMATE-2", readDefault: "CREATOMATE-15", readLimited: "CREATOMATE-13", readSilent: "CREATOMATE-14",
            callbackDone: "CREATOMATE-6", callbackNotALine: "CREATOMATE-16", callbackMalformed: "CREATOMATE-17", callbackNeverStarted: "CREATOMATE-18",
        },
    },
    {
        key: "json2video",
        catalogue: JSON2VIDEO_SANDBOX_CATALOGUE,
        make: (sandbox) => new Json2VideoSandboxComposeService(sandbox),
        ids: {
            refused: "JSON2VIDEO-3", auth: "JSON2VIDEO-10", limited: "JSON2VIDEO-11", silent: "JSON2VIDEO-12", unknownApplied: "JSON2VIDEO-4",
            never: "JSON2VIDEO-9", fails: "JSON2VIDEO-2", readDefault: "JSON2VIDEO-13", readLimited: "JSON2VIDEO-15", readSilent: "JSON2VIDEO-16",
            callbackDone: "JSON2VIDEO-6", callbackNotALine: "JSON2VIDEO-8", callbackMalformed: "JSON2VIDEO-17", callbackNeverStarted: "JSON2VIDEO-18",
        },
    },
    {
        key: "shotstack",
        catalogue: SHOTSTACK_SANDBOX_CATALOGUE,
        make: (sandbox) => new ShotstackSandboxComposeService(sandbox),
        ids: {
            refused: "SHOTSTACK-3", auth: "SHOTSTACK-9", limited: "SHOTSTACK-10", silent: "SHOTSTACK-11", unknownApplied: "SHOTSTACK-4",
            never: "SHOTSTACK-8", fails: "SHOTSTACK-2", readDefault: "SHOTSTACK-12", readLimited: "SHOTSTACK-14", readSilent: "SHOTSTACK-15",
            callbackDone: "SHOTSTACK-6", callbackNotALine: "SHOTSTACK-16", callbackMalformed: "SHOTSTACK-17", callbackNeverStarted: "SHOTSTACK-18",
        },
    },
]

const WS = "ws-1"
const AT = new Date("2026-11-15T03:00:00.000Z")
const caller = (connectionId: string): NativeCaller => ({ agentId: "agent-1", conversationId: null, connectionId })

/** The world of one provider: its sandbox account, the compose tools over the registry, and the account's sandbox frame. */
const worldOf = async (row: Row) => {
    const account = sandboxAccount({ provider: row.key, workspaceId: WS })
    const record: ConnectionRecord = connectionRecord({ provider: row.key, id: account.id, workspaceId: WS, sandbox: true })
    const { sandbox } = sandboxServiceOf(account)
    const port = row.make(sandbox)
    const registry = new VideoComposeRegistryService()
    registry.register({ live: mock<VideoComposePort>({ provider: row.key }), sandbox: port })
    const connections = mock<ConnectionsService>()
    connections.find.mockResolvedValue(record)
    connections.publicOrigin.mockReturnValue("https://api.nivo.test")
    connections.readSecret.mockResolvedValue(null)
    const moduleRef = await Test.createTestingModule({
        providers: [VideoComposeNativeService, { provide: ConnectionsService, useValue: connections }, { provide: VideoComposeRegistryService, useValue: registry }],
    }).compile()
    const tool = moduleRef.get(VideoComposeNativeService)
    return {
        account,
        sandbox,
        port,
        pick: (operation: string, caseId: string): Promise<void> => sandbox.setNextCase(account, operation, caseId),
        compose: () => tool.invoke(WS, VIDEO_COMPOSE_TOOL.compose, { spec: SOUND_SPEC }, caller(account.id)),
        read: (renderId: string) => tool.invoke(WS, VIDEO_COMPOSE_TOOL.renderGet, { renderId }, caller(account.id)),
    }
}

const failureOf = (work: Promise<unknown>): Promise<unknown> => work.then(() => undefined, (cause: unknown) => cause)

describe.each(ROWS)("the compose tools over the $key sandbox (second kind of the SBX standard)", (row) => {
    it("start answered 429: the live rate-limit error proving not_sent reaches the tool runner (it falls back to the next account); no render started", async () => {
        const w = await worldOf(row)
        await w.pick("start", row.ids.limited)

        const cause = await failureOf(w.compose())

        expect(causeFactsOf(cause).code).toMatch(/RATE_LIMITED$/u)
        expect(proofOf(cause)).toBe("not_sent")
        await w.pick("start", row.catalogue.cases.find((one) => one.operation === "start" && one.default === true)?.id ?? "")
        await expect(w.compose()).resolves.toMatchObject({ renderId: expect.stringMatching(/-000002$/u) })
    })

    it("start with no answer: proof unknown and NOTHING started (a read of the next id is the tool's not_found); the unknown-applied twin leaves the render to read", async () => {
        const w = await worldOf(row)
        await w.pick("start", row.ids.silent)
        const silent = await failureOf(w.compose())
        expect(proofOf(silent)).toBe("unknown")
        const missing = await failureOf(w.read(`SBX-${row.key.toUpperCase()}-000001`))
        expect(causeParamsOf(missing)).toMatchObject({ reason: "not_found" })

        await w.pick("start", row.ids.unknownApplied)
        const applied = await failureOf(w.compose())
        expect(proofOf(applied)).toBe("unknown")
        await expect(w.read(`SBX-${row.key.toUpperCase()}-000002`)).resolves.toMatchObject({ status: "queued", provider: row.key })
    })

    it("start refused for the key: the tool's infrastructure refusal connection_refused; refused for credits: the business refusal provider_refused", async () => {
        const w = await worldOf(row)
        await w.pick("start", row.ids.auth)
        const auth = await failureOf(w.compose())
        await w.pick("start", row.ids.refused)
        const refused = await failureOf(w.compose())

        expect(causeFactsOf(auth).code).toBe(ToolsErrorCode.NativeRefused)
        expect(causeParamsOf(auth)).toMatchObject({ reason: "connection_refused", refusalClass: "infrastructure" })
        expect(causeParamsOf(refused)).toMatchObject({ reason: "provider_refused", refusalClass: "business" })
    })

    it("a render that never finishes: every read through video.render.get stays in progress with no address and no error (the run's deadline is what ends the wait)", async () => {
        const w = await worldOf(row)
        await w.pick("start", row.ids.never)
        const started = await w.compose()
        const renderId = isRecord(started) && typeof started.renderId === "string" ? started.renderId : ""

        const reads: Array<unknown> = []
        for (let one = 0; one < 6; one += 1) reads.push(await w.read(renderId))

        for (const read of reads) expect(read).toMatchObject({ outputUrl: null, error: null })
        expect(reads.map((read) => (isRecord(read) ? read.status : null))).toEqual(["queued", "rendering", "rendering", "rendering", "rendering", "rendering"])
    })

    it("a lost callback is the status read's to find (RENDER_WITHOUT_POLL): a render started with no callback ever sent still reads to its end through the tool", async () => {
        const w = await worldOf(row)
        const started = await w.compose()
        const renderId = isRecord(started) && typeof started.renderId === "string" ? started.renderId : ""

        const reads: Array<unknown> = []
        for (let one = 0; one < 5; one += 1) reads.push(await w.read(renderId))

        expect(reads.at(-1)).toMatchObject({ status: "done", error: null })
    })

    it("a status read answered 429 or with no answer fails as the live twin does, proof carried to the runner", async () => {
        const w = await worldOf(row)
        const started = await w.compose()
        const renderId = isRecord(started) && typeof started.renderId === "string" ? started.renderId : ""

        await w.pick("statusOf", row.ids.readLimited)
        const limited = await failureOf(w.read(renderId))
        await w.pick("statusOf", row.ids.readSilent)
        const silent = await failureOf(w.read(renderId))
        await w.pick("statusOf", row.ids.readDefault)

        expect([proofOf(limited), proofOf(silent)]).toEqual(["not_sent", "unknown"])
        await expect(w.read(renderId)).resolves.toMatchObject({ status: "queued" })
    })
})

describe.each(ROWS)("the render door's intake over the $key callbacks (second kind of the SBX standard)", (row) => {
    const account = sandboxAccount({ provider: row.key, workspaceId: WS })
    const owner = { id: account.id, workspaceId: WS, provider: row.key }

    /** The intake with the sandbox port registered as the provider's port (its `completionOf` is the live pure mapper). */
    const intakeOf = async () => {
        const { sandbox } = sandboxServiceOf(account)
        const manager = mockEntityManager()
        fakeTransaction(manager)
        const bindings = mock<ConnectionBindingsReadService>()
        bindings.accountOf.mockResolvedValue(owner)
        const keptIds = new Set<string>()
        const intake = mock<AccountDataIntakeService>()
        intake.claim.mockImplementation((_tx, claimed) => {
            const key = String(isRecord(claimed.value) ? claimed.value["renderId"] : undefined)
            if (keptIds.has(key)) return Promise.resolve(undefined)
            keptIds.add(key)
            return Promise.resolve({ type: claimed.type, key, id: `row-${key}`, isNew: true })
        })
        const outbox = recordingQueueOutbox()
        const write = jest.spyOn(outbox, "write")
        const connections = mock<ConnectionsService>()
        connections.readSecret.mockResolvedValue({ plain: "cred", webhookSecret: "hook" })
        const moduleRef = await Test.createTestingModule({
            providers: [
                VideoRenderIntakeService,
                VideoRenderAdmissionService,
                AccountDataAdmissionsService,
                { provide: PRIMARY_ENTITY_MANAGER, useValue: manager },
                { provide: LOGGER, useValue: mock<Logger>() },
                VideoComposeRegistryService,
                { provide: ConnectionBindingsReadService, useValue: bindings },
                { provide: ConnectionsService, useValue: connections },
                { provide: AccountDataIntakeService, useValue: intake },
                { provide: QUEUE_OUTBOX, useValue: outbox },
            ],
        }).compile()
        moduleRef.get(VideoComposeRegistryService).register(row.make(sandbox))
        moduleRef.get(VideoRenderAdmissionService).register()
        return { sandbox, service: moduleRef.get(VideoRenderIntakeService), intake, write }
    }

    /** The body a catalogue case would post, as the raw request the door receives. */
    const deliveryOf = async (sandbox: ReturnType<typeof sandboxServiceOf>["sandbox"], caseId: string): Promise<RenderDoorDelivery> => {
        const one = row.catalogue.cases.find((entry) => entry.id === caseId)
        if (one?.inbound === undefined) throw new Error(`${caseId} is no inbound case`)
        const events = await sandbox.inbound(account, one.id, one.inbound, Object.fromEntries(one.inbound.inputs.map((field) => [field.name, field.example])), AT)
        return { provider: row.key, connectionId: account.id, rawBody: Buffer.from(JSON.stringify(events[0]?.body)), headers: {} }
    }

    it("a done callback is kept once and wakes the trigger; the same callback again is a repeat (nothing written twice)", async () => {
        const { sandbox, service, write } = await intakeOf()

        await expect(service.accept(await deliveryOf(sandbox, row.ids.callbackDone))).resolves.toBe("kept")
        await expect(service.accept(await deliveryOf(sandbox, row.ids.callbackDone))).resolves.toBe("repeat")

        expect(write).toHaveBeenCalledTimes(1)
    })

    it.each([
        ["a callback that is no finished render (progress, test ping, another action)", "callbackNotALine"],
        ["a callback that says done with no https video address", "callbackMalformed"],
    ] as const)("keeps nothing for %s: the door acknowledges it and writes no row, no job", async (_name, which) => {
        const { sandbox, service, intake, write } = await intakeOf()

        await expect(service.accept(await deliveryOf(sandbox, row.ids[which]))).resolves.toBe("ignored")

        expect(intake.claim).not.toHaveBeenCalled()
        expect(write).not.toHaveBeenCalled()
    })

    it("a callback for a render the account never started is kept by its id once (the door asks no account's history; no waiting run matches it)", async () => {
        const { sandbox, service, intake } = await intakeOf()

        await expect(service.accept(await deliveryOf(sandbox, row.ids.callbackNeverStarted))).resolves.toBe("kept")

        expect(intake.claim).toHaveBeenCalledTimes(1)
        expect(intake.claim.mock.calls[0]?.[1]).toMatchObject({ connectionId: account.id, type: `${row.key}.render`, value: { status: "done", provider: row.key } })
    })
})
