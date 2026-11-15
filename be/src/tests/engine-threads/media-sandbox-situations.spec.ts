import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { ConnectionsService } from "@modules/domain/connections"
import { ElevenLabsSandboxMediaService } from "@modules/domain/elevenlabs-provider/elevenlabs-sandbox-media.service"
import { MediaNativeService, MEDIA_TOOL } from "@modules/domain/media-tools/media-native.service"
import { PROVIDER_FILE_SINK } from "@modules/domain/media-tools/media-native.decorators"
import {
    DubbingRegistryService,
    proofOf,
    SpeechRegistryService,
    VideoGenerationRegistryService,
    type DubbingPort,
    type ProviderFileSink,
    type SpeechPort,
    type VideoGenerationPort,
} from "@modules/domain/provider-registry"
import { ToolsErrorCode, type NativeCaller } from "@modules/domain/tools"
import { VeoSandboxVideoService } from "@modules/domain/veo-provider/veo-sandbox-video.service"
import { isRecord } from "@modules/platform/primitives"
import { causeFactsOf, causeParamsOf } from "@tests/fixtures/builders/cause-facts.builder"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"

/*
 * THE SECOND KIND of the SBX standard for the media providers (SBX-MEDIA): the situations the ElevenLabs and Veo sandboxes answer, proven
 * through the DOOR that consumes them (the generic media tools, whose runner falls back on a `not_sent` proof and freezes on an
 * infrastructure refusal), and the same job situations proven on BOTH providers (a polled long job: dubbing and video generation).
 */

const WS = "ws-1"
const caller = (connectionId: string): NativeCaller => ({ agentId: "agent-1", conversationId: null, connectionId })
const failureOf = (work: Promise<unknown>): Promise<unknown> => work.then(() => undefined, (cause: unknown) => cause)

/** One world: a sandbox account of `key`, its sandbox port registered for the purposes it serves, the media tools over them. */
const worldOf = async (key: "elevenlabs" | "veo") => {
    const account = sandboxAccount({ provider: key, workspaceId: WS })
    const record = connectionRecord({ provider: key, id: account.id, workspaceId: WS, sandbox: true, meta: { model: "veo-3.0-generate-001" } })
    const { sandbox } = sandboxServiceOf(account)
    const speech = new SpeechRegistryService()
    const dubbing = new DubbingRegistryService()
    const videos = new VideoGenerationRegistryService()
    if (key === "elevenlabs") {
        const twin = new ElevenLabsSandboxMediaService(sandbox)
        speech.register({ live: mock<SpeechPort>({ provider: key }), sandbox: twin })
        dubbing.register({ live: mock<DubbingPort>({ provider: key }), sandbox: twin })
    } else {
        videos.register({ live: mock<VideoGenerationPort>({ provider: key }), sandbox: new VeoSandboxVideoService(sandbox) })
    }
    const connections = mock<ConnectionsService>()
    connections.find.mockResolvedValue(record)
    const sink = mock<ProviderFileSink>()
    sink.store.mockResolvedValue("file-1")
    const moduleRef = await Test.createTestingModule({
        providers: [
            MediaNativeService,
            { provide: ConnectionsService, useValue: connections },
            { provide: SpeechRegistryService, useValue: speech },
            { provide: DubbingRegistryService, useValue: dubbing },
            { provide: VideoGenerationRegistryService, useValue: videos },
            { provide: PROVIDER_FILE_SINK, useValue: sink },
        ],
    }).compile()
    const tool = moduleRef.get(MediaNativeService)
    const run = (name: string, args: Record<string, unknown>) => tool.invoke(WS, name, args as never, caller(account.id))
    return { account, sandbox, run, pick: (operation: string, caseId: string): Promise<void> => sandbox.setNextCase(account, operation, caseId) }
}

/** The job family of each provider: the start tool and its arguments, the read tool, the case ids of its situations, the id the first job gets. */
const JOBS = [
    {
        key: "elevenlabs" as const,
        start: MEDIA_TOOL.dubbingCreate,
        startArgs: { sourceUrl: "https://store.test/source.mp4", targetLanguage: "vi" },
        read: MEDIA_TOOL.dubbingGet,
        op: { start: "create", read: "get" },
        ids: { never: "ELEVENLABS-20", limited: "ELEVENLABS-22", silent: "ELEVENLABS-23", unknownApplied: "ELEVENLABS-9", auth: "ELEVENLABS-21", refused: "ELEVENLABS-8", readLimited: "ELEVENLABS-26", readSilent: "ELEVENLABS-27", readDefault: "ELEVENLABS-24", ok: "ELEVENLABS-6" },
        firstId: "SBX-DUBBING-000001",
        secondId: "SBX-DUBBING-000002",
    },
    {
        key: "veo" as const,
        start: MEDIA_TOOL.videoGenerate,
        startArgs: { prompt: "a short film" },
        read: MEDIA_TOOL.videoGenerationGet,
        op: { start: "start", read: "get" },
        ids: { never: "VEO-10", limited: "VEO-12", silent: "VEO-13", unknownApplied: "VEO-5", auth: "VEO-11", refused: "VEO-4", readLimited: "VEO-16", readSilent: "VEO-17", readDefault: "VEO-14", ok: "VEO-1" },
        firstId: "models/veo-3.0-generate-001/operations/SBX-VEO-000001",
        secondId: "models/veo-3.0-generate-001/operations/SBX-VEO-000002",
    },
]

describe.each(JOBS)("the media tools over the $key sandbox: a polled long job (second kind of the SBX standard)", (job) => {
    it("start answered 429: the live rate-limit error proving not_sent reaches the runner; nothing started; the next start gets the first id", async () => {
        const w = await worldOf(job.key)
        await w.pick(job.op.start, job.ids.limited)

        const cause = await failureOf(w.run(job.start, job.startArgs))

        expect(causeFactsOf(cause).code).toMatch(/RATE_LIMITED$/u)
        expect(proofOf(cause)).toBe("not_sent")
        await w.pick(job.op.start, job.ids.ok)
        await expect(w.run(job.start, job.startArgs)).resolves.toMatchObject({ jobId: job.secondId })
        await expect(failureOf(w.run(job.read, { jobId: job.firstId }))).resolves.toMatchObject({ code: ToolsErrorCode.NativeRefused })
    })

    it("start with no answer: proof unknown and NOTHING started (the read is the tool's not_found); the unknown-applied twin leaves the job to read", async () => {
        const w = await worldOf(job.key)
        await w.pick(job.op.start, job.ids.silent)
        const silent = await failureOf(w.run(job.start, job.startArgs))
        expect(proofOf(silent)).toBe("unknown")
        expect(causeParamsOf(await failureOf(w.run(job.read, { jobId: job.firstId })))).toMatchObject({ reason: "not_found", refusalClass: "business" })

        await w.pick(job.op.start, job.ids.unknownApplied)
        const applied = await failureOf(w.run(job.start, job.startArgs))
        expect(proofOf(applied)).toBe("unknown")
        await expect(w.run(job.read, { jobId: job.secondId })).resolves.toMatchObject({ state: "pending" })
    })

    it("start refused for the key: the tool's infrastructure refusal connection_refused; refused as asked: the business refusal rejected", async () => {
        const w = await worldOf(job.key)
        await w.pick(job.op.start, job.ids.auth)
        const auth = await failureOf(w.run(job.start, job.startArgs))
        await w.pick(job.op.start, job.ids.refused)
        const refused = await failureOf(w.run(job.start, job.startArgs))

        expect(causeFactsOf(auth).code).toBe(ToolsErrorCode.NativeRefused)
        expect(causeParamsOf(auth)).toMatchObject({ reason: "connection_refused", refusalClass: "infrastructure" })
        expect(causeParamsOf(refused)).toMatchObject({ reason: "rejected", refusalClass: "business" })
    })

    it("a job that never finishes: every read through the tool stays pending with no file and no error (the run's deadline ends the wait)", async () => {
        const w = await worldOf(job.key)
        await w.pick(job.op.start, job.ids.never)
        await w.run(job.start, job.startArgs)

        const reads: Array<unknown> = []
        for (let one = 0; one < 7; one += 1) reads.push(await w.run(job.read, { jobId: job.firstId }))

        for (const read of reads) expect(read).toMatchObject({ state: "pending", error: null, files: [] })
    })

    it("a read answered 429 or with no answer fails as the live twin does, proof carried to the runner", async () => {
        const w = await worldOf(job.key)
        await w.run(job.start, job.startArgs)

        await w.pick(job.op.read, job.ids.readLimited)
        const limited = await failureOf(w.run(job.read, { jobId: job.firstId }))
        await w.pick(job.op.read, job.ids.readSilent)
        const silent = await failureOf(w.run(job.read, { jobId: job.firstId }))
        await w.pick(job.op.read, job.ids.readDefault)

        expect([proofOf(limited), proofOf(silent)]).toEqual(["not_sent", "unknown"])
        await expect(w.run(job.read, { jobId: job.firstId })).resolves.toMatchObject({ state: "pending" })
    })
})

describe("the media tools over the elevenlabs sandbox: speech and the voice list (second kind of the SBX standard)", () => {
    const SPEAK = { text: "Xin chao", voiceId: "SBX-VOICE-RACHEL" }

    it("a spent quota is the account's picked case (no magic voice id): the business refusal rejected; a 429, no answer and a 5xx carry their proofs to the runner", async () => {
        const w = await worldOf("elevenlabs")

        await w.pick("synthesize", "ELEVENLABS-5")
        const quota = await failureOf(w.run(MEDIA_TOOL.speechGenerate, SPEAK))
        await w.pick("synthesize", "ELEVENLABS-17")
        const limited = await failureOf(w.run(MEDIA_TOOL.speechGenerate, SPEAK))
        await w.pick("synthesize", "ELEVENLABS-18")
        const silent = await failureOf(w.run(MEDIA_TOOL.speechGenerate, SPEAK))
        await w.pick("synthesize", "ELEVENLABS-19")
        const broken = await failureOf(w.run(MEDIA_TOOL.speechGenerate, SPEAK))
        await w.pick("synthesize", "ELEVENLABS-3")

        expect(causeParamsOf(quota)).toMatchObject({ reason: "rejected", refusalClass: "business" })
        expect([proofOf(limited), proofOf(silent), proofOf(broken)]).toEqual(["not_sent", "unknown", "unknown"])
        const spoken = await w.run(MEDIA_TOOL.speechGenerate, SPEAK)
        expect(isRecord(spoken) ? spoken.file : null).toMatchObject({ provider: "elevenlabs" })
    })

    it("the voice list refused for the key is the infrastructure refusal; paged by its token when the account asks for a page", async () => {
        const w = await worldOf("elevenlabs")
        const paged = await w.run(MEDIA_TOOL.speechVoiceList, { pageSize: 2 })
        expect(paged).toMatchObject({ nextPageToken: "SBX-PAGE-2" })

        await w.pick("voices", "ELEVENLABS-13")
        const refused = await failureOf(w.run(MEDIA_TOOL.speechVoiceList, {}))

        expect(causeParamsOf(refused)).toMatchObject({ reason: "connection_refused", refusalClass: "infrastructure" })
    })
})
