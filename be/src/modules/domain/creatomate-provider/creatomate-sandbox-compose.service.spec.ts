import { readFileSync } from "node:fs"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import { CreatomateError, CreatomateErrorCode } from "@modules/integrations/creatomate"
import { SOUND_SPEC } from "@tests/fixtures/builders/video-compose.builder"
import { proofOf, ProviderRegistryErrorCode, providerRefusalDetail, providerRefusalReason } from "@modules/domain/provider-registry"
import { ProviderSandboxError, ProviderSandboxErrorCode, type SandboxCase } from "@modules/domain/provider-sandbox"
import type { ComposeSpec, RenderState } from "@modules/domain/video-compose"
import {
    CREATOMATE_SANDBOX_CATALOGUE,
    CREATOMATE_SANDBOX_FAILED_MESSAGE,
    CREATOMATE_SANDBOX_NEVER_STARTED_ID,
    CREATOMATE_SANDBOX_NOT_FOUND_HINT,
    CREATOMATE_SANDBOX_NO_CREDITS_HINT,
    CREATOMATE_SANDBOX_OUTPUT_URL,
} from "./creatomate-sandbox.catalogue"
import { CreatomateSandboxComposeService } from "./creatomate-sandbox-compose.service"

const account = sandboxAccount({ provider: "creatomate" })
const connection = connectionRecord({ provider: "creatomate", id: account.id, workspaceId: account.workspaceId, sandbox: true })

const build = () => {
    const { sandbox } = sandboxServiceOf(account)
    return { sandbox, service: new CreatomateSandboxComposeService(sandbox) }
}

/** The account picks the next case of an operation (sticky), as the Sandbox page does. */
const pick = (sandbox: ReturnType<typeof build>["sandbox"], operation: string, caseId: string): Promise<void> => sandbox.setNextCase(account, operation, caseId)

const AT = new Date("2026-11-14T03:00:00.000Z")

/** The webhook body a catalogue case builds from its default input (R62: the case's transformation, through the sandbox's own inbound send). */
const bodyOf = async (sandbox: ReturnType<typeof build>["sandbox"], one: SandboxCase | undefined): Promise<unknown> => {
    if (one?.inbound === undefined) throw new Error("not an inbound case")
    const events = await sandbox.inbound(account, one.id, one.inbound, Object.fromEntries(one.inbound.inputs.map((field) => [field.name, field.example])), AT)
    expect(events).toHaveLength(1)
    return events[0]?.body
}

const failure = (work: Promise<unknown>): Promise<unknown> => Promise.resolve(work.then(() => undefined, (cause: unknown) => cause))

describe("CreatomateSandboxComposeService > start and status", () => {
    it("CREATOMATE-1: accepts a render, then reads queued, rendering, done with the video address, and holds done", async () => {
        const { sandbox, service } = build()

        const started = await service.start(connection, SOUND_SPEC, { url: "https://hooks.test/x" })

        expect(started).toEqual({ renderId: "SBX-CREATOMATE-000001" })
        const polls = [
            await service.statusOf(connection, started.renderId),
            await service.statusOf(connection, started.renderId),
            await service.statusOf(connection, started.renderId),
            await service.statusOf(connection, started.renderId),
        ]
        expect(polls).toEqual([
            { renderId: started.renderId, status: "queued" },
            { renderId: started.renderId, status: "rendering" },
            { renderId: started.renderId, status: "done", outputUrl: CREATOMATE_SANDBOX_OUTPUT_URL },
            { renderId: started.renderId, status: "done", outputUrl: CREATOMATE_SANDBOX_OUTPUT_URL },
        ])
        expect(await sandbox.calls(account, "start")).toHaveLength(1)
        expect(await sandbox.calls(account, "statusOf")).toHaveLength(4)
    })

    it("takes the default case (a render that completes) when the account picked none, with the next running id", async () => {
        const { service } = build()

        await service.start(connection, SOUND_SPEC, null)
        const second = await service.start(connection, SOUND_SPEC, null)

        expect(second).toEqual({ renderId: "SBX-CREATOMATE-000002" })
        await service.statusOf(connection, second.renderId)
        await service.statusOf(connection, second.renderId)
        await expect(service.statusOf(connection, second.renderId)).resolves.toMatchObject({ status: "done" })
    })

    it("CREATOMATE-2: a render that later fails ends at failed with the provider's words", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "CREATOMATE-2")
        const { renderId } = await service.start(connection, SOUND_SPEC, null)

        await service.statusOf(connection, renderId)
        await service.statusOf(connection, renderId)

        await expect(service.statusOf(connection, renderId)).resolves.toEqual({ renderId, status: "failed", error: CREATOMATE_SANDBOX_FAILED_MESSAGE })
    })

    it("CREATOMATE-3: a render refused for no credits is the live refusal (rejected, not_sent, the hint) and starts nothing", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "CREATOMATE-3")

        const cause = await failure(service.start(connection, SOUND_SPEC, null))

        expect(providerRefusalReason(cause)).toBe("rejected")
        expect(providerRefusalDetail(cause)).toBe(CREATOMATE_SANDBOX_NO_CREDITS_HINT)
        expect(proofOf(cause)).toBe("not_sent")
        await pick(sandbox, "start", "CREATOMATE-1")
        const next = await service.start(connection, SOUND_SPEC, null)
        expect(next.renderId).toBe("SBX-CREATOMATE-000002")
        await expect(failure(service.statusOf(connection, "SBX-CREATOMATE-000001"))).resolves.toMatchObject({ code: ProviderRegistryErrorCode.RefusedNotFound })
        expect((await sandbox.calls(account, "start"))[0]?.result).toEqual({ outcome: "threw", error: ProviderRegistryErrorCode.RefusedRejected })
    })

    it("CREATOMATE-4: an unknown outcome throws the unknown proof AFTER the render exists, so its status can be read", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "CREATOMATE-4")

        const cause = await failure(service.start(connection, SOUND_SPEC, null))

        expect(cause).toBeInstanceOf(CreatomateError)
        expect(cause).toMatchObject({ code: CreatomateErrorCode.Failed })
        expect(proofOf(cause)).toBe("unknown")
        await expect(service.statusOf(connection, "SBX-CREATOMATE-000001")).resolves.toEqual({ renderId: "SBX-CREATOMATE-000001", status: "queued" })
    })

    it("refuses a spec the RenderScript cannot carry as the live does (rejected, not_sent), before any case", async () => {
        const { service } = build()
        const spec: ComposeSpec = { ...SOUND_SPEC, captions: [{ text: "x", fromMs: 500, toMs: 500 }] }

        const cause = await failure(service.start(connection, spec, null))

        expect(providerRefusalReason(cause)).toBe("rejected")
        expect(providerRefusalDetail(cause)).toContain("captions.0")
        expect(proofOf(cause)).toBe("not_sent")
    })

    it("CREATOMATE-5: a status read of a render the account does not hold is the not_found refusal", async () => {
        const { service } = build()

        const cause = await failure(service.statusOf(connection, "SBX-CREATOMATE-000009"))

        expect(providerRefusalReason(cause)).toBe("not_found")
        expect(providerRefusalDetail(cause)).toBe(CREATOMATE_SANDBOX_NOT_FOUND_HINT)
        expect(proofOf(cause)).toBe("not_sent")
    })

    it("is deterministic: two fresh accounts answer the same ids and statuses", async () => {
        const answers = async (): Promise<unknown> => {
            const { service } = build()
            const { renderId } = await service.start(connection, SOUND_SPEC, null)
            return [renderId, await service.statusOf(connection, renderId), await service.statusOf(connection, renderId)]
        }

        expect(await answers()).toEqual(await answers())
    })

    it("keeps each account's renders apart", async () => {
        const other = sandboxAccount({ provider: "creatomate", id: "sbx-conn-2" })
        const { sandbox } = sandboxServiceOf(account, other)
        const service = new CreatomateSandboxComposeService(sandbox)
        const otherConnection = connectionRecord({ provider: "creatomate", id: other.id, workspaceId: other.workspaceId, sandbox: true })
        await service.start(connection, SOUND_SPEC, null)

        await expect(service.start(otherConnection, SOUND_SPEC, null)).resolves.toEqual({ renderId: "SBX-CREATOMATE-000001" })
    })
})

describe("CreatomateSandboxComposeService > the webhook, the frame and the law", () => {
    it("maps the webhook cases with the live completion mapper and gives the provider's real route", async () => {
        const { sandbox, service } = build()
        const inbound = CREATOMATE_SANDBOX_CATALOGUE.cases.filter((one) => one.inbound !== undefined)

        expect(inbound.map((one) => one.id)).toEqual(["CREATOMATE-6", "CREATOMATE-7", "CREATOMATE-16", "CREATOMATE-17", "CREATOMATE-18"])
        expect(service.completionOf(await bodyOf(sandbox, inbound[0]))).toEqual({ renderId: "SBX-CREATOMATE-000001", status: "done", outputUrl: CREATOMATE_SANDBOX_OUTPUT_URL })
        expect(service.completionOf(await bodyOf(sandbox, inbound[1]))).toEqual({
            renderId: "SBX-CREATOMATE-000002",
            status: "failed",
            error: CREATOMATE_SANDBOX_FAILED_MESSAGE,
        })
        for (const one of inbound) {
            expect(one.inbound?.path("c-9")).toBe("api/connections/video-render/creatomate/c-9/sandbox")
            expect(one.inbound?.trigger).toBe("render.completed")
        }
        expect(service.proves()).toBe(true)
        expect(service.webhook).toEqual({ signatureHeader: null, timestampHeader: null })
    })

    it("has unique ids of the form CREATOMATE-<n>", () => {
        const ids = CREATOMATE_SANDBOX_CATALOGUE.cases.map((one) => one.id)

        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.every((id) => /^CREATOMATE-\d+$/.test(id))).toBe(true)
        expect(CREATOMATE_SANDBOX_CATALOGUE.provider).toBe("creatomate")
    })

    it("refuses a live account (PROVIDER_SANDBOX_LIVE_ACCOUNT)", async () => {
        const live = sandboxAccount({ provider: "creatomate", id: "live-1", sandbox: false })
        const { sandbox } = sandboxServiceOf(live)
        const service = new CreatomateSandboxComposeService(sandbox)

        const cause = await failure(service.start(connectionRecord({ provider: "creatomate", id: live.id }), SOUND_SPEC, null))

        expect(cause).toBeInstanceOf(ProviderSandboxError)
        expect(cause).toMatchObject({ code: ProviderSandboxErrorCode.LiveAccount })
    })

    it("is refused with the switch off (PROVIDER_SANDBOX_OFF)", async () => {
        const { sandbox } = sandboxServiceOff(account)
        const service = new CreatomateSandboxComposeService(sandbox)

        await expect(failure(service.statusOf(connection, "x"))).resolves.toMatchObject({ code: ProviderSandboxErrorCode.Off })
    })

    it("reaches no network: one constructor argument and no client or host in its source", () => {
        const source = readFileSync(__filename.replace(".spec.ts", ".ts"), "utf8")

        expect(CreatomateSandboxComposeService.length).toBe(1)
        expect(source).not.toContain("@modules/integrations")
        expect(source).not.toContain("http")
        // The picked-by-clip-address road is gone: no clip address, no first clip, picks an answer.
        expect(source).not.toContain("fileUrl")
    })
})

describe("CreatomateSandboxComposeService > the situations of the SBX standard (next case, the live twin's answers)", () => {
    it("CREATOMATE-8: a render that never finishes: reads see queued, then rendering for ever (never done, never failed)", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "CREATOMATE-8")
        const { renderId } = await service.start(connection, SOUND_SPEC, null)

        const reads: Array<RenderState> = []
        for (let one = 0; one < 8; one += 1) reads.push(await service.statusOf(connection, renderId))

        expect(reads.map((read) => read.status)).toEqual(["queued", "rendering", "rendering", "rendering", "rendering", "rendering", "rendering", "rendering"])
        expect(reads.every((read) => read.outputUrl === undefined && read.error === undefined)).toBe(true)
    })

    it("CREATOMATE-9: the key refused at start is the live auth_refused refusal (not_sent); no render exists", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "CREATOMATE-9")

        const cause = await failure(service.start(connection, SOUND_SPEC, null))

        expect(providerRefusalReason(cause)).toBe("auth_refused")
        expect(proofOf(cause)).toBe("not_sent")
        await pick(sandbox, "start", "CREATOMATE-1")
        await expect(service.start(connection, SOUND_SPEC, null)).resolves.toEqual({ renderId: "SBX-CREATOMATE-000002" })
    })

    it("CREATOMATE-10: a 429 at start is the live rate-limit error proving not_sent, sticky until the account picks another case, and starts nothing", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "CREATOMATE-10")

        const first = await failure(service.start(connection, SOUND_SPEC, null))
        const second = await failure(service.start(connection, SOUND_SPEC, null))

        for (const cause of [first, second]) {
            expect(cause).toBeInstanceOf(CreatomateError)
            expect(cause).toMatchObject({ code: CreatomateErrorCode.RateLimited, params: { status: 429, retryAfterSeconds: 30 } })
            expect(proofOf(cause)).toBe("not_sent")
        }
        await pick(sandbox, "start", "CREATOMATE-1")
        await expect(service.start(connection, SOUND_SPEC, null)).resolves.toEqual({ renderId: "SBX-CREATOMATE-000003" })
    })

    it("CREATOMATE-11: no answer at start is the live `Unreachable` proving unknown, and NOTHING was started (no render of that id)", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "CREATOMATE-11")

        const cause = await failure(service.start(connection, SOUND_SPEC, null))

        expect(cause).toBeInstanceOf(CreatomateError)
        expect(cause).toMatchObject({ code: CreatomateErrorCode.Unreachable })
        expect(proofOf(cause)).toBe("unknown")
        await expect(failure(service.statusOf(connection, "SBX-CREATOMATE-000001"))).resolves.toMatchObject({ code: ProviderRegistryErrorCode.RefusedNotFound })
    })

    it("CREATOMATE-4 differs from CREATOMATE-11 only by what was applied: the render exists", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "CREATOMATE-4")
        await failure(service.start(connection, SOUND_SPEC, null))

        await expect(service.statusOf(connection, "SBX-CREATOMATE-000001")).resolves.toMatchObject({ status: "queued" })
    })

    it("CREATOMATE-15 is the default read (a started render's life); CREATOMATE-5 forces not_found even for a render the account holds", async () => {
        const { sandbox, service } = build()
        const { renderId } = await service.start(connection, SOUND_SPEC, null)
        await pick(sandbox, "statusOf", "CREATOMATE-5")

        const cause = await failure(service.statusOf(connection, renderId))

        expect(providerRefusalReason(cause)).toBe("not_found")
        await pick(sandbox, "statusOf", "CREATOMATE-15")
        await expect(service.statusOf(connection, renderId)).resolves.toEqual({ renderId, status: "queued" })
    })

    it("CREATOMATE-12 / 13 / 14: a status read refused for the key, answered 429, or with no answer fails as the live twin does", async () => {
        const { sandbox, service } = build()
        const { renderId } = await service.start(connection, SOUND_SPEC, null)

        await pick(sandbox, "statusOf", "CREATOMATE-12")
        const refused = await failure(service.statusOf(connection, renderId))
        await pick(sandbox, "statusOf", "CREATOMATE-13")
        const limited = await failure(service.statusOf(connection, renderId))
        await pick(sandbox, "statusOf", "CREATOMATE-14")
        const silent = await failure(service.statusOf(connection, renderId))

        expect(providerRefusalReason(refused)).toBe("auth_refused")
        expect(proofOf(refused)).toBe("not_sent")
        expect(limited).toMatchObject({ code: CreatomateErrorCode.RateLimited })
        expect(proofOf(limited)).toBe("not_sent")
        expect(silent).toMatchObject({ code: CreatomateErrorCode.Unreachable })
        expect(proofOf(silent)).toBe("unknown")
        await pick(sandbox, "statusOf", "CREATOMATE-15")
        await expect(service.statusOf(connection, renderId)).resolves.toEqual({ renderId, status: "queued" })
    })

    it("CREATOMATE-16 / 17 / 18: the callbacks the live mapper reads as no finished render (progress, no video) or as a render nobody started", async () => {
        const { sandbox, service } = build()
        const byId = (id: string): SandboxCase | undefined => CREATOMATE_SANDBOX_CATALOGUE.cases.find((one) => one.id === id)

        expect(service.completionOf(await bodyOf(sandbox, byId("CREATOMATE-16")))).toBeNull()
        expect(service.completionOf(await bodyOf(sandbox, byId("CREATOMATE-17")))).toBeNull()
        expect(service.completionOf(await bodyOf(sandbox, byId("CREATOMATE-18")))).toEqual({
            renderId: CREATOMATE_SANDBOX_NEVER_STARTED_ID,
            status: "done",
            outputUrl: CREATOMATE_SANDBOX_OUTPUT_URL,
        })
        await expect(failure(service.statusOf(connection, CREATOMATE_SANDBOX_NEVER_STARTED_ID))).resolves.toMatchObject({ code: ProviderRegistryErrorCode.RefusedNotFound })
    })

    it("every outbound case has an outcome tag and each operation exactly one default, tagged ok; the tag order picks the plain case first", () => {
        const outbound = CREATOMATE_SANDBOX_CATALOGUE.cases.filter((one) => one.operation !== undefined)
        for (const operation of ["start", "statusOf"]) {
            const own = outbound.filter((one) => one.operation === operation)
            expect(own.filter((one) => one.default === true).map((one) => one.outcome)).toEqual(["ok"])
            expect(own.every((one) => one.outcome !== undefined)).toBe(true)
        }
        const firstOf = (outcome: string): string | undefined => outbound.find((one) => one.operation === "start" && one.outcome === outcome)?.id
        expect(["ok", "refused", "transient", "timeout"].map(firstOf)).toEqual(["CREATOMATE-1", "CREATOMATE-3", "CREATOMATE-10", "CREATOMATE-11"])
    })
})
