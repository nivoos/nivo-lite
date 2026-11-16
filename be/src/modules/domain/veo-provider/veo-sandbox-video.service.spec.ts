import { readFileSync } from "node:fs"
import { VeoError, VeoErrorCode } from "@modules/integrations/veo"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import {
    proofOf,
    ProviderRegistryErrorCode,
    providerRefusalDetail,
    providerRefusalReason,
    type VideoJob,
    type VideoRequest,
} from "@modules/domain/provider-registry"
import { ProviderSandboxError, ProviderSandboxErrorCode } from "@modules/domain/provider-sandbox"
import {
    VEO_SANDBOX_CATALOGUE,
    VEO_SANDBOX_FAILED_ERROR,
    VEO_SANDBOX_FILE_NOT_FOUND_MESSAGE,
    VEO_SANDBOX_JOB_NOT_FOUND_MESSAGE,
    VEO_SANDBOX_NO_MODEL_DETAIL,
    VEO_SANDBOX_REJECTED_MESSAGE,
    VEO_SANDBOX_VIDEO_MIME,
    veoSandboxVideoBytesOf,
} from "./veo-sandbox.catalogue"
import { VeoSandboxVideoService } from "./veo-sandbox-video.service"

const MODEL = "veo-3.0-generate-001"
const account = sandboxAccount({ provider: "veo" })
const connection = connectionRecord({ provider: "veo", id: account.id, workspaceId: account.workspaceId, sandbox: true, meta: { model: MODEL } })
const bareConnection = connectionRecord({ provider: "veo", id: account.id, workspaceId: account.workspaceId, sandbox: true })

const build = () => {
    const { sandbox } = sandboxServiceOf(account)
    return { sandbox, service: new VeoSandboxVideoService(sandbox) }
}

const requestOf = (prompt: string, modelId: string | null = null): VideoRequest => ({
    prompt,
    image: null,
    modelId,
    aspectRatio: null,
    resolution: null,
    durationSeconds: null,
    personGeneration: null,
    seed: null,
})

/** The account picks the next case of an operation (sticky), as the Sandbox page does. */
const pick = (sandbox: ReturnType<typeof build>["sandbox"], operation: string, caseId: string): Promise<void> => sandbox.setNextCase(account, operation, caseId)

const failure = (work: Promise<unknown>): Promise<unknown> => Promise.resolve(work.then(() => undefined, (cause: unknown) => cause))

describe("VeoSandboxVideoService > generation and files", () => {
    it("VEO-1 and 8: accepts a generation (the account's model), reads pending twice then done with one video that reopens with fixed bytes", async () => {
        const { sandbox, service } = build()

        const started = await service.start(connection, requestOf("a prompt"))
        const reads = [await service.get(connection, started.jobId), await service.get(connection, started.jobId), await service.get(connection, started.jobId)]

        expect(started).toEqual({ jobId: `models/${MODEL}/operations/SBX-VEO-000001`, modelId: MODEL })
        expect(reads[0]).toEqual({ jobId: started.jobId, state: "pending", error: null, files: [] })
        expect(reads[1]?.state).toBe("pending")
        const done = reads[2]
        const uri = "https://sandbox.nivo.test/veo/files/SBX-VEO-000001.mp4"
        expect(done).toMatchObject({ state: "done", error: null })
        expect(done?.files.map((file) => [file.handle, file.mimeType])).toEqual([[uri, VEO_SANDBOX_VIDEO_MIME]])
        await expect(done?.files[0]?.fetch()).resolves.toEqual(veoSandboxVideoBytesOf(uri))
        await expect(service.open(connection, uri).fetch()).resolves.toEqual(veoSandboxVideoBytesOf(uri))
        expect(await sandbox.calls(account, "start")).toHaveLength(1)
        expect(await sandbox.calls(account, "get")).toHaveLength(3)
        expect(await sandbox.calls(account, "file")).toHaveLength(2)
    })

    it("takes the request's model before the account's, and the default case when the account picked none", async () => {
        const { service } = build()

        const first = await service.start(connection, requestOf("a prompt the catalogue never named", "veo-2.0"))
        const second = await service.start(connection, requestOf("a prompt"))

        expect(first).toEqual({ jobId: "models/veo-2.0/operations/SBX-VEO-000001", modelId: "veo-2.0" })
        expect(second.jobId).toBe(`models/${MODEL}/operations/SBX-VEO-000002`)
    })

    it("VEO-2: a generation that later fails ends failed with Google's code and words", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "VEO-2")
        const { jobId } = await service.start(connection, requestOf("a prompt"))

        await service.get(connection, jobId)
        await service.get(connection, jobId)

        await expect(service.get(connection, jobId)).resolves.toEqual({ jobId, state: "failed", error: VEO_SANDBOX_FAILED_ERROR, files: [] })
    })

    it("VEO-3: a generation the filters block ends done with no video", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "VEO-3")
        const { jobId } = await service.start(connection, requestOf("a prompt"))

        await service.get(connection, jobId)
        await service.get(connection, jobId)

        await expect(service.get(connection, jobId)).resolves.toEqual({ jobId, state: "done", error: null, files: [] })
    })

    it("VEO-4: a prompt refused at start is the live refusal (rejected, not_sent) and starts nothing", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "VEO-4")

        const cause = await failure(service.start(connection, requestOf("a prompt")))

        expect(providerRefusalReason(cause)).toBe("rejected")
        expect(providerRefusalDetail(cause)).toBe(VEO_SANDBOX_REJECTED_MESSAGE)
        expect(proofOf(cause)).toBe("not_sent")
        await pick(sandbox, "start", "VEO-1")
        const next = await service.start(connection, requestOf("a prompt"))
        expect(next.jobId).toBe(`models/${MODEL}/operations/SBX-VEO-000002`)
        await expect(failure(service.get(connection, `models/${MODEL}/operations/SBX-VEO-000001`))).resolves.toMatchObject({
            code: ProviderRegistryErrorCode.RefusedNotFound,
        })
    })

    it("VEO-5: an unknown outcome throws the unknown proof AFTER the operation exists", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "VEO-5")

        const cause = await failure(service.start(connection, requestOf("a prompt")))

        expect(cause).toBeInstanceOf(VeoError)
        expect(cause).toMatchObject({ code: VeoErrorCode.Failed })
        expect(proofOf(cause)).toBe("unknown")
        await expect(service.get(connection, `models/${MODEL}/operations/SBX-VEO-000001`)).resolves.toMatchObject({ state: "pending" })
    })

    it("VEO-6: a start naming no model, neither the request's nor the account's, is refused rejected / not_sent", async () => {
        const { service } = build()

        const cause = await failure(service.start(bareConnection, requestOf("a prompt")))

        expect(providerRefusalReason(cause)).toBe("rejected")
        expect(providerRefusalDetail(cause)).toBe(VEO_SANDBOX_NO_MODEL_DETAIL)
        expect(proofOf(cause)).toBe("not_sent")
    })

    it("VEO-7: a read of an operation the account does not hold is the not_found refusal", async () => {
        const { service } = build()

        const cause = await failure(service.get(connection, "models/x/operations/none"))

        expect(providerRefusalReason(cause)).toBe("not_found")
        expect(providerRefusalDetail(cause)).toBe(VEO_SANDBOX_JOB_NOT_FOUND_MESSAGE)
        expect(proofOf(cause)).toBe("not_sent")
    })

    it("VEO-9: a video URI no read answered is the not_found refusal", async () => {
        const { service } = build()

        const cause = await failure(service.open(connection, "https://sandbox.nivo.test/veo/files/never.mp4").fetch())

        expect(providerRefusalReason(cause)).toBe("not_found")
        expect(providerRefusalDetail(cause)).toBe(VEO_SANDBOX_FILE_NOT_FOUND_MESSAGE)
        expect(proofOf(cause)).toBe("not_sent")
    })

    it("is deterministic: two fresh accounts answer the same names, states and bytes", async () => {
        const answers = async (): Promise<string> => {
            const { service } = build()
            const { jobId } = await service.start(connection, requestOf("a prompt"))
            await service.get(connection, jobId)
            await service.get(connection, jobId)
            const done = await service.get(connection, jobId)
            return JSON.stringify([jobId, done, await done.files[0]?.fetch()])
        }

        expect(await answers()).toBe(await answers())
    })
})

describe("VeoSandboxVideoService > the frame and the law", () => {
    it("has unique ids of the form VEO-<n>, and no inbound case (Veo is polled)", () => {
        const ids = VEO_SANDBOX_CATALOGUE.cases.map((one) => one.id)

        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.every((id) => /^VEO-\d+$/.test(id))).toBe(true)
        expect(VEO_SANDBOX_CATALOGUE.provider).toBe("veo")
        expect(VEO_SANDBOX_CATALOGUE.cases.some((one) => one.inbound !== undefined)).toBe(false)
    })

    it("refuses a live account (PROVIDER_SANDBOX_LIVE_ACCOUNT)", async () => {
        const live = sandboxAccount({ provider: "veo", id: "live-1", sandbox: false })
        const { sandbox } = sandboxServiceOf(live)
        const service = new VeoSandboxVideoService(sandbox)

        const cause = await failure(service.start(connectionRecord({ provider: "veo", id: live.id, meta: { model: MODEL } }), requestOf("x")))

        expect(cause).toBeInstanceOf(ProviderSandboxError)
        expect(cause).toMatchObject({ code: ProviderSandboxErrorCode.LiveAccount })
    })

    it("is refused with the switch off (PROVIDER_SANDBOX_OFF)", async () => {
        const { sandbox } = sandboxServiceOff(account)
        const service = new VeoSandboxVideoService(sandbox)

        await expect(failure(service.get(connection, "x"))).resolves.toMatchObject({ code: ProviderSandboxErrorCode.Off })
    })

    it("reaches no network: one constructor argument and no client or host in its source", () => {
        const source = readFileSync(__filename.replace(".spec.ts", ".ts"), "utf8")

        expect(VeoSandboxVideoService.length).toBe(1)
        expect(source).not.toContain("@modules/integrations")
        expect(source).not.toContain("http")
    })
})

describe("VeoSandboxVideoService > the situations of the SBX standard (next case, the live twin's answers)", () => {
    it("VEO-10: a generation that never finishes: reads stay pending for ever (never done, never failed), with no file", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "VEO-10")
        const { jobId } = await service.start(connection, requestOf("a prompt"))

        const reads: Array<VideoJob> = []
        for (let one = 0; one < 8; one += 1) reads.push(await service.get(connection, jobId))

        expect(reads.every((read) => read.state === "pending" && read.error === null && read.files.length === 0)).toBe(true)
    })

    it("VEO-6 picked explicitly refuses the start as no model even when the account holds one", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "VEO-6")

        const cause = await failure(service.start(connection, requestOf("a prompt")))

        expect(providerRefusalReason(cause)).toBe("rejected")
        expect(providerRefusalDetail(cause)).toBe(VEO_SANDBOX_NO_MODEL_DETAIL)
        expect(proofOf(cause)).toBe("not_sent")
    })

    it("VEO-11: the key refused at start is the live auth_refused refusal (not_sent); no operation exists", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "VEO-11")

        const cause = await failure(service.start(connection, requestOf("a prompt")))

        expect(providerRefusalReason(cause)).toBe("auth_refused")
        expect(proofOf(cause)).toBe("not_sent")
        await pick(sandbox, "start", "VEO-1")
        await expect(service.start(connection, requestOf("a prompt"))).resolves.toMatchObject({ jobId: `models/${MODEL}/operations/SBX-VEO-000002` })
    })

    it("VEO-12: a 429 at start is the live rate-limit error proving not_sent, sticky until the account picks another case, and starts nothing", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "VEO-12")

        const first = await failure(service.start(connection, requestOf("a prompt")))
        const second = await failure(service.start(connection, requestOf("a prompt")))

        for (const cause of [first, second]) {
            expect(cause).toBeInstanceOf(VeoError)
            expect(cause).toMatchObject({ code: VeoErrorCode.RateLimited, params: { status: 429, retryAfterSeconds: 30 } })
            expect(proofOf(cause)).toBe("not_sent")
        }
        await pick(sandbox, "start", "VEO-1")
        await expect(service.start(connection, requestOf("a prompt"))).resolves.toMatchObject({ jobId: `models/${MODEL}/operations/SBX-VEO-000003` })
    })

    it("VEO-13: no answer at start is the live `Unreachable` proving unknown, and NOTHING was started", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "VEO-13")

        const cause = await failure(service.start(connection, requestOf("a prompt")))

        expect(cause).toBeInstanceOf(VeoError)
        expect(cause).toMatchObject({ code: VeoErrorCode.Unreachable })
        expect(proofOf(cause)).toBe("unknown")
        await expect(failure(service.get(connection, `models/${MODEL}/operations/SBX-VEO-000001`))).resolves.toMatchObject({ code: ProviderRegistryErrorCode.RefusedNotFound })
    })

    it("VEO-14 is the default read; VEO-7 forces not_found even for an operation the account holds; VEO-15 / 16 / 17 fail the read as the live twin does", async () => {
        const { sandbox, service } = build()
        const { jobId } = await service.start(connection, requestOf("a prompt"))

        await pick(sandbox, "get", "VEO-7")
        const missing = await failure(service.get(connection, jobId))
        await pick(sandbox, "get", "VEO-15")
        const refused = await failure(service.get(connection, jobId))
        await pick(sandbox, "get", "VEO-16")
        const limited = await failure(service.get(connection, jobId))
        await pick(sandbox, "get", "VEO-17")
        const silent = await failure(service.get(connection, jobId))

        expect(providerRefusalReason(missing)).toBe("not_found")
        expect(providerRefusalReason(refused)).toBe("auth_refused")
        expect(proofOf(refused)).toBe("not_sent")
        expect(limited).toMatchObject({ code: VeoErrorCode.RateLimited })
        expect(proofOf(limited)).toBe("not_sent")
        expect(silent).toMatchObject({ code: VeoErrorCode.Unreachable })
        expect(proofOf(silent)).toBe("unknown")
        await pick(sandbox, "get", "VEO-14")
        await expect(service.get(connection, jobId)).resolves.toMatchObject({ state: "pending" })
    })

    it("VEO-8 is the default fetch; VEO-9 / 18 / 19 / 20 fail the fetch of a video the account holds as the live twin does", async () => {
        const { sandbox, service } = build()
        const { jobId } = await service.start(connection, requestOf("a prompt"))
        await service.get(connection, jobId)
        await service.get(connection, jobId)
        const done = await service.get(connection, jobId)
        const video = done.files[0]
        if (video === undefined) throw new Error("the generation holds a video")

        await pick(sandbox, "file", "VEO-9")
        const missing = await failure(video.fetch())
        await pick(sandbox, "file", "VEO-18")
        const refused = await failure(video.fetch())
        await pick(sandbox, "file", "VEO-19")
        const limited = await failure(video.fetch())
        await pick(sandbox, "file", "VEO-20")
        const silent = await failure(video.fetch())

        expect(providerRefusalReason(missing)).toBe("not_found")
        expect(providerRefusalReason(refused)).toBe("auth_refused")
        expect(limited).toMatchObject({ code: VeoErrorCode.RateLimited })
        expect(silent).toMatchObject({ code: VeoErrorCode.Unreachable })
        expect(proofOf(silent)).toBe("unknown")
        await pick(sandbox, "file", "VEO-8")
        await expect(video.fetch()).resolves.toEqual(veoSandboxVideoBytesOf(video.handle))
    })

    it("every outbound case has an outcome tag and each operation exactly one default, tagged ok; the tag order picks the plain case first", () => {
        const outbound = VEO_SANDBOX_CATALOGUE.cases.filter((one) => one.operation !== undefined)
        for (const operation of ["start", "get", "file"]) {
            const own = outbound.filter((one) => one.operation === operation)
            expect(own.filter((one) => one.default === true).map((one) => one.outcome)).toEqual(["ok"])
            expect(own.every((one) => one.outcome !== undefined)).toBe(true)
        }
        const firstOf = (operation: string, outcome: string): string | undefined => outbound.find((one) => one.operation === operation && one.outcome === outcome)?.id
        expect(["ok", "refused", "transient", "timeout"].map((outcome) => firstOf("start", outcome))).toEqual(["VEO-1", "VEO-4", "VEO-12", "VEO-13"])
    })
})
