import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { ElevenlabsError, ElevenlabsErrorCode } from "@modules/integrations/elevenlabs"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import {
    proofOf,
    ProviderRegistryErrorCode,
    providerRefusalDetail,
    providerRefusalReason,
    type DubbingRequest,
    type SpeechRequest,
} from "@modules/domain/provider-registry"
import { ProviderSandboxError, ProviderSandboxErrorCode } from "@modules/domain/provider-sandbox"
import {
    ELEVENLABS_SANDBOX_CATALOGUE,
    ELEVENLABS_SANDBOX_DUBBING_ERROR,
    ELEVENLABS_SANDBOX_DUBBING_NOT_FOUND_MESSAGE,
    ELEVENLABS_SANDBOX_EXPECTED_SECONDS,
    ELEVENLABS_SANDBOX_PAGE_TOKEN_MESSAGE,
    ELEVENLABS_SANDBOX_QUOTA_MESSAGE,
    ELEVENLABS_SANDBOX_SPEECH_MIME,
    ELEVENLABS_SANDBOX_VOICES,
    ELEVENLABS_SANDBOX_VOICE_NOT_FOUND_MESSAGE,
    elevenLabsSandboxClipOf,
    elevenLabsSandboxDubbedBytesOf,
} from "./elevenlabs-sandbox.catalogue"
import { ElevenLabsSandboxMediaService } from "./elevenlabs-sandbox-media.service"

const account = sandboxAccount({ provider: "elevenlabs" })
const connection = connectionRecord({ provider: "elevenlabs", id: account.id, workspaceId: account.workspaceId, sandbox: true })

const build = () => {
    const { sandbox } = sandboxServiceOf(account)
    return { sandbox, service: new ElevenLabsSandboxMediaService(sandbox) }
}

/** The account picks the next case of an operation (sticky), as the Sandbox page does. */
const pick = (sandbox: ReturnType<typeof build>["sandbox"], operation: string, caseId: string): Promise<void> => sandbox.setNextCase(account, operation, caseId)

const speechOf = (voiceId: string, text = "Xin chao"): SpeechRequest => ({ text, voiceId, modelId: null, languageCode: null, format: null, seed: null })

const dubOf = (sourceUrl: string, targetLanguage = "en"): DubbingRequest => ({
    sourceUrl,
    targetLanguage,
    sourceLanguage: null,
    name: null,
    speakers: null,
    watermark: null,
})

const failure = (work: Promise<unknown>): Promise<unknown> => Promise.resolve(work.then(() => undefined, (cause: unknown) => cause))

describe("ElevenLabsSandboxMediaService > speech", () => {
    it("ELEVENLABS-1: lists the fixed voices, paged by the page size with the next token", async () => {
        const { sandbox, service } = build()

        const first = await service.voices(connection, { search: null, pageSize: 2, pageToken: null })
        const second = await service.voices(connection, { search: null, pageSize: 2, pageToken: first.nextPageToken })

        expect(first.voices).toEqual(ELEVENLABS_SANDBOX_VOICES.slice(0, 2))
        expect(first.nextPageToken).toBe("SBX-PAGE-2")
        expect(second).toEqual({ voices: ELEVENLABS_SANDBOX_VOICES.slice(2), nextPageToken: null })
        expect(await sandbox.calls(account, "voices")).toHaveLength(2)
    })

    it("ELEVENLABS-2: a search the catalogue names finds its voices; another finds none; a foreign token is refused", async () => {
        const { service } = build()

        const rachel = await service.voices(connection, { search: "Rachel", pageSize: 10, pageToken: null })
        const narration = await service.voices(connection, { search: "narration", pageSize: 10, pageToken: null })
        const none = await service.voices(connection, { search: "nothing", pageSize: 10, pageToken: null })
        const cause = await failure(service.voices(connection, { search: null, pageSize: 10, pageToken: "forged" }))

        expect(rachel.voices.map((voice) => voice.name)).toEqual(["Rachel"])
        expect(narration.voices.map((voice) => voice.name)).toEqual(["Rachel", "Adam"])
        expect(none).toEqual({ voices: [], nextPageToken: null })
        expect(providerRefusalReason(cause)).toBe("rejected")
        expect(providerRefusalDetail(cause)).toBe(ELEVENLABS_SANDBOX_PAGE_TOKEN_MESSAGE)
        expect(proofOf(cause)).toBe("not_sent")
    })

    it("ELEVENLABS-3: speech of a held voice is a clip of fixed bytes behind a speech handle", async () => {
        const { sandbox, service } = build()

        const file = await service.synthesize(connection, speechOf("SBX-VOICE-RACHEL"))

        const bytes = elevenLabsSandboxClipOf("SBX-VOICE-RACHEL", "Xin chao")
        expect(file).toMatchObject({
            provider: "elevenlabs",
            handle: `speech/${createHash("sha256").update(bytes).digest("hex")}`,
            mimeType: ELEVENLABS_SANDBOX_SPEECH_MIME,
            expiresAt: null,
        })
        await expect(file.fetch()).resolves.toEqual(bytes)
        expect(await sandbox.calls(account, "synthesize")).toHaveLength(1)
    })

    it("ELEVENLABS-4 and 5: an unheld voice is not_found, a spent quota (the account picked the case: no magic voice id any more) is rejected, both proved not_sent", async () => {
        const { sandbox, service } = build()

        const missing = await failure(service.synthesize(connection, speechOf("SBX-VOICE-NONE")))
        // The old magic voice id is just a voice the account does not hold now.
        const oldMagic = await failure(service.synthesize(connection, speechOf("SBX-VOICE-QUOTA")))
        await pick(sandbox, "synthesize", "ELEVENLABS-5")
        const quota = await failure(service.synthesize(connection, speechOf("SBX-VOICE-RACHEL")))
        expect(providerRefusalReason(oldMagic)).toBe("not_found")

        expect(providerRefusalReason(missing)).toBe("not_found")
        expect(providerRefusalDetail(missing)).toBe(ELEVENLABS_SANDBOX_VOICE_NOT_FOUND_MESSAGE)
        expect(providerRefusalReason(quota)).toBe("rejected")
        expect(providerRefusalDetail(quota)).toBe(ELEVENLABS_SANDBOX_QUOTA_MESSAGE)
        expect([proofOf(missing), proofOf(quota)]).toEqual(["not_sent", "not_sent"])
    })
})

describe("ElevenLabsSandboxMediaService > dubbing and files", () => {
    it("ELEVENLABS-6 and 11: a dub is accepted, reads dubbing then dubbed with its file, whose handle reopens with fixed bytes", async () => {
        const { sandbox, service } = build()

        const started = await service.create(connection, dubOf("https://sandbox.nivo.test/media/any.mp4", "vi"))
        const running = await service.get(connection, started.jobId)
        const done = await service.get(connection, started.jobId)

        expect(started).toEqual({ jobId: "SBX-DUBBING-000001", expectedSeconds: ELEVENLABS_SANDBOX_EXPECTED_SECONDS })
        expect(running).toEqual({ jobId: started.jobId, state: "pending", providerStatus: "dubbing", targetLanguages: ["vi"], error: null, files: [] })
        expect(done).toMatchObject({ jobId: started.jobId, state: "done", providerStatus: "dubbed", targetLanguages: ["vi"], error: null })
        expect(done.files.map((file) => file.handle)).toEqual(["dubbing/SBX-DUBBING-000001/vi"])
        const reopened = service.open(connection, "dubbing/SBX-DUBBING-000001/vi")
        await expect(reopened.fetch()).resolves.toEqual(elevenLabsSandboxDubbedBytesOf("SBX-DUBBING-000001", "vi"))
        await expect(done.files[0]?.fetch()).resolves.toEqual(elevenLabsSandboxDubbedBytesOf("SBX-DUBBING-000001", "vi"))
        expect(await sandbox.calls(account, "create")).toHaveLength(1)
        expect(await sandbox.calls(account, "get")).toHaveLength(2)
        expect(await sandbox.calls(account, "file")).toHaveLength(2)
    })

    it("a dubbing with no case picked takes the default case (completes), with the next running id", async () => {
        const { service } = build()

        await service.create(connection, dubOf("https://sandbox.nivo.test/media/any.mp4"))
        const second = await service.create(connection, dubOf("a-source-nobody-named"))

        expect(second.jobId).toBe("SBX-DUBBING-000002")
        await service.get(connection, second.jobId)
        await expect(service.get(connection, second.jobId)).resolves.toMatchObject({ state: "done" })
    })

    it("ELEVENLABS-7: a dub that later fails ends failed with the provider's words and no file", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "create", "ELEVENLABS-7")
        const { jobId } = await service.create(connection, dubOf("https://sandbox.nivo.test/media/any.mp4"))

        await service.get(connection, jobId)

        await expect(service.get(connection, jobId)).resolves.toEqual({
            jobId,
            state: "failed",
            providerStatus: "failed",
            targetLanguages: ["en"],
            error: ELEVENLABS_SANDBOX_DUBBING_ERROR,
            files: [],
        })
    })

    it("ELEVENLABS-8: a source refused at start is the live refusal (rejected, not_sent) and starts nothing", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "create", "ELEVENLABS-8")

        const cause = await failure(service.create(connection, dubOf("https://sandbox.nivo.test/media/any.mp4")))

        expect(providerRefusalReason(cause)).toBe("rejected")
        expect(proofOf(cause)).toBe("not_sent")
        await expect(failure(service.get(connection, "SBX-DUBBING-000001"))).resolves.toMatchObject({ code: ProviderRegistryErrorCode.RefusedNotFound })
    })

    it("ELEVENLABS-9: an unknown outcome throws the unknown proof AFTER the job exists", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "create", "ELEVENLABS-9")

        const cause = await failure(service.create(connection, dubOf("https://sandbox.nivo.test/media/any.mp4")))

        expect(cause).toBeInstanceOf(ElevenlabsError)
        expect(cause).toMatchObject({ code: ElevenlabsErrorCode.Failed })
        expect(proofOf(cause)).toBe("unknown")
        await expect(service.get(connection, "SBX-DUBBING-000001")).resolves.toMatchObject({ state: "pending" })
    })

    it("ELEVENLABS-10: a read of a job the account does not hold is the not_found refusal", async () => {
        const { service } = build()

        const cause = await failure(service.get(connection, "SBX-DUBBING-000009"))

        expect(providerRefusalReason(cause)).toBe("not_found")
        expect(providerRefusalDetail(cause)).toBe(ELEVENLABS_SANDBOX_DUBBING_NOT_FOUND_MESSAGE)
        expect(proofOf(cause)).toBe("not_sent")
    })

    it("ELEVENLABS-12: a speech handle, a malformed handle or a language the job does not dub is not_found", async () => {
        const { service } = build()
        const { jobId } = await service.create(connection, dubOf("https://sandbox.nivo.test/media/any.mp4", "vi"))

        for (const handle of ["speech/abc", "dubbing/only-two", `dubbing/${jobId}/fr`, "dubbing/SBX-DUBBING-000009/vi"]) {
            const cause = await failure(service.open(connection, handle).fetch())
            expect(providerRefusalReason(cause)).toBe("not_found")
            expect(proofOf(cause)).toBe("not_sent")
        }
    })

    it("is deterministic: two fresh accounts answer the same ids and bytes", async () => {
        const answers = async (): Promise<unknown> => {
            const { service } = build()
            const { jobId } = await service.create(connection, dubOf("https://sandbox.nivo.test/media/any.mp4"))
            await service.get(connection, jobId)
            const done = await service.get(connection, jobId)
            return [jobId, done, await done.files[0]?.fetch()]
        }

        expect(JSON.stringify(await answers())).toBe(JSON.stringify(await answers()))
    })
})

describe("ElevenLabsSandboxMediaService > the frame and the law", () => {
    it("has unique ids of the form ELEVENLABS-<n>, and no inbound case (ElevenLabs is polled)", () => {
        const ids = ELEVENLABS_SANDBOX_CATALOGUE.cases.map((one) => one.id)

        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.every((id) => /^ELEVENLABS-\d+$/.test(id))).toBe(true)
        expect(ELEVENLABS_SANDBOX_CATALOGUE.provider).toBe("elevenlabs")
        expect(ELEVENLABS_SANDBOX_CATALOGUE.cases.some((one) => one.inbound !== undefined)).toBe(false)
    })

    it("refuses a live account (PROVIDER_SANDBOX_LIVE_ACCOUNT)", async () => {
        const live = sandboxAccount({ provider: "elevenlabs", id: "live-1", sandbox: false })
        const { sandbox } = sandboxServiceOf(live)
        const service = new ElevenLabsSandboxMediaService(sandbox)

        const cause = await failure(service.voices(connectionRecord({ provider: "elevenlabs", id: live.id }), { search: null, pageSize: 1, pageToken: null }))

        expect(cause).toBeInstanceOf(ProviderSandboxError)
        expect(cause).toMatchObject({ code: ProviderSandboxErrorCode.LiveAccount })
    })

    it("is refused with the switch off (PROVIDER_SANDBOX_OFF)", async () => {
        const { sandbox } = sandboxServiceOff(account)
        const service = new ElevenLabsSandboxMediaService(sandbox)

        await expect(failure(service.get(connection, "x"))).resolves.toMatchObject({ code: ProviderSandboxErrorCode.Off })
    })

    it("reaches no network: one constructor argument and no client or host in its source", () => {
        const source = readFileSync(__filename.replace(".spec.ts", ".ts"), "utf8")

        expect(ElevenLabsSandboxMediaService.length).toBe(1)
        expect(source).not.toContain("@modules/integrations")
        expect(source).not.toContain("http")
    })
})

describe("ElevenLabsSandboxMediaService > the situations of the SBX standard (next case, the live twin's answers)", () => {
    const URL_ = "https://sandbox.nivo.test/media/any.mp4"

    it("ELEVENLABS-20: a dubbing that never finishes: reads stay `dubbing` for ever (never dubbed, never failed), with no file", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "create", "ELEVENLABS-20")
        const { jobId } = await service.create(connection, dubOf(URL_))

        const reads = []
        for (let one = 0; one < 8; one += 1) reads.push(await service.get(connection, jobId))

        expect(reads.every((read) => read.state === "pending" && read.providerStatus === "dubbing" && read.error === null && read.files.length === 0)).toBe(true)
    })

    it("ELEVENLABS-21 / 22 / 23: a dubbing start refused for the key, answered 429 or with no answer fails as the live twin does and starts NOTHING", async () => {
        const { sandbox, service } = build()

        await pick(sandbox, "create", "ELEVENLABS-21")
        const refused = await failure(service.create(connection, dubOf(URL_)))
        await pick(sandbox, "create", "ELEVENLABS-22")
        const limited = await failure(service.create(connection, dubOf(URL_)))
        await pick(sandbox, "create", "ELEVENLABS-23")
        const silent = await failure(service.create(connection, dubOf(URL_)))

        expect(providerRefusalReason(refused)).toBe("auth_refused")
        expect(proofOf(refused)).toBe("not_sent")
        expect(limited).toBeInstanceOf(ElevenlabsError)
        expect(limited).toMatchObject({ code: ElevenlabsErrorCode.RateLimited, params: { status: 429, retryAfterSeconds: 30 } })
        expect(proofOf(limited)).toBe("not_sent")
        expect(silent).toMatchObject({ code: ElevenlabsErrorCode.Unreachable })
        expect(proofOf(silent)).toBe("unknown")
        await pick(sandbox, "create", "ELEVENLABS-6")
        await expect(service.create(connection, dubOf(URL_))).resolves.toMatchObject({ jobId: "SBX-DUBBING-000004" })
        await expect(failure(service.get(connection, "SBX-DUBBING-000001"))).resolves.toMatchObject({ code: ProviderRegistryErrorCode.RefusedNotFound })
    })

    it("ELEVENLABS-9 differs from ELEVENLABS-23 only by what was applied: the job exists", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "create", "ELEVENLABS-9")
        await failure(service.create(connection, dubOf(URL_)))

        await expect(service.get(connection, "SBX-DUBBING-000001")).resolves.toMatchObject({ state: "pending" })
    })

    it("ELEVENLABS-13 / 14 / 15: the voice list refused for the key, answered 429 or with no answer fails as the live twin does", async () => {
        const { sandbox, service } = build()
        const query = { search: null, pageSize: 10, pageToken: null }

        await pick(sandbox, "voices", "ELEVENLABS-13")
        const refused = await failure(service.voices(connection, query))
        await pick(sandbox, "voices", "ELEVENLABS-14")
        const limited = await failure(service.voices(connection, query))
        await pick(sandbox, "voices", "ELEVENLABS-15")
        const silent = await failure(service.voices(connection, query))

        expect(providerRefusalReason(refused)).toBe("auth_refused")
        expect(limited).toMatchObject({ code: ElevenlabsErrorCode.RateLimited })
        expect(proofOf(limited)).toBe("not_sent")
        expect(silent).toMatchObject({ code: ElevenlabsErrorCode.Unreachable })
        expect(proofOf(silent)).toBe("unknown")
        await pick(sandbox, "voices", "ELEVENLABS-1")
        await expect(service.voices(connection, query)).resolves.toMatchObject({ voices: ELEVENLABS_SANDBOX_VOICES })
    })

    it("ELEVENLABS-16 / 17 / 18 / 19: speech refused for the key, answered 429, with no answer or with a 5xx fails as the live twin does", async () => {
        const { sandbox, service } = build()
        const request = speechOf("SBX-VOICE-RACHEL")

        await pick(sandbox, "synthesize", "ELEVENLABS-16")
        const refused = await failure(service.synthesize(connection, request))
        await pick(sandbox, "synthesize", "ELEVENLABS-17")
        const limited = await failure(service.synthesize(connection, request))
        await pick(sandbox, "synthesize", "ELEVENLABS-18")
        const silent = await failure(service.synthesize(connection, request))
        await pick(sandbox, "synthesize", "ELEVENLABS-19")
        const broken = await failure(service.synthesize(connection, request))

        expect(providerRefusalReason(refused)).toBe("auth_refused")
        expect(proofOf(refused)).toBe("not_sent")
        expect(limited).toMatchObject({ code: ElevenlabsErrorCode.RateLimited })
        expect(proofOf(limited)).toBe("not_sent")
        expect(silent).toMatchObject({ code: ElevenlabsErrorCode.Unreachable })
        expect(broken).toMatchObject({ code: ElevenlabsErrorCode.Failed })
        expect([proofOf(silent), proofOf(broken)]).toEqual(["unknown", "unknown"])
        await pick(sandbox, "synthesize", "ELEVENLABS-3")
        await expect(service.synthesize(connection, request)).resolves.toMatchObject({ mimeType: ELEVENLABS_SANDBOX_SPEECH_MIME })
    })

    it("ELEVENLABS-24 is the default read; 10 / 25 / 26 / 27 fail the dubbing read as the live twin does", async () => {
        const { sandbox, service } = build()
        const { jobId } = await service.create(connection, dubOf(URL_))

        await pick(sandbox, "get", "ELEVENLABS-10")
        const missing = await failure(service.get(connection, jobId))
        await pick(sandbox, "get", "ELEVENLABS-25")
        const refused = await failure(service.get(connection, jobId))
        await pick(sandbox, "get", "ELEVENLABS-26")
        const limited = await failure(service.get(connection, jobId))
        await pick(sandbox, "get", "ELEVENLABS-27")
        const silent = await failure(service.get(connection, jobId))

        expect(providerRefusalReason(missing)).toBe("not_found")
        expect(providerRefusalReason(refused)).toBe("auth_refused")
        expect(limited).toMatchObject({ code: ElevenlabsErrorCode.RateLimited })
        expect(silent).toMatchObject({ code: ElevenlabsErrorCode.Unreachable })
        expect(proofOf(silent)).toBe("unknown")
        await pick(sandbox, "get", "ELEVENLABS-24")
        await expect(service.get(connection, jobId)).resolves.toMatchObject({ state: "pending" })
    })

    it("ELEVENLABS-11 is the default fetch; 12 / 28 / 29 / 30 fail the fetch of a dubbed language the account holds as the live twin does", async () => {
        const { sandbox, service } = build()
        const { jobId } = await service.create(connection, dubOf(URL_, "vi"))
        const handle = `dubbing/${jobId}/vi`

        await pick(sandbox, "file", "ELEVENLABS-12")
        const missing = await failure(service.open(connection, handle).fetch())
        await pick(sandbox, "file", "ELEVENLABS-28")
        const refused = await failure(service.open(connection, handle).fetch())
        await pick(sandbox, "file", "ELEVENLABS-29")
        const limited = await failure(service.open(connection, handle).fetch())
        await pick(sandbox, "file", "ELEVENLABS-30")
        const silent = await failure(service.open(connection, handle).fetch())

        expect(providerRefusalReason(missing)).toBe("not_found")
        expect(providerRefusalReason(refused)).toBe("auth_refused")
        expect(limited).toMatchObject({ code: ElevenlabsErrorCode.RateLimited })
        expect(silent).toMatchObject({ code: ElevenlabsErrorCode.Unreachable })
        await pick(sandbox, "file", "ELEVENLABS-11")
        await expect(service.open(connection, handle).fetch()).resolves.toEqual(elevenLabsSandboxDubbedBytesOf(jobId, "vi"))
    })

    it("every outbound case has an outcome tag and each operation exactly one default, tagged ok; the tag order picks the plain case first", () => {
        const outbound = ELEVENLABS_SANDBOX_CATALOGUE.cases.filter((one) => one.operation !== undefined)
        for (const operation of ["voices", "synthesize", "create", "get", "file"]) {
            const own = outbound.filter((one) => one.operation === operation)
            expect(own.filter((one) => one.default === true).map((one) => one.outcome)).toEqual(["ok"])
            expect(own.every((one) => one.outcome !== undefined)).toBe(true)
        }
        const firstOf = (operation: string, outcome: string): string | undefined => outbound.find((one) => one.operation === operation && one.outcome === outcome)?.id
        expect(["ok", "refused", "transient", "timeout"].map((outcome) => firstOf("create", outcome))).toEqual(["ELEVENLABS-6", "ELEVENLABS-8", "ELEVENLABS-22", "ELEVENLABS-23"])
        expect(["ok", "refused", "transient", "timeout"].map((outcome) => firstOf("synthesize", outcome))).toEqual(["ELEVENLABS-3", "ELEVENLABS-5", "ELEVENLABS-17", "ELEVENLABS-18"])
    })
})
