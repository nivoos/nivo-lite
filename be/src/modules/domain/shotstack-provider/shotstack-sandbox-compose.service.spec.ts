import { readFileSync } from "node:fs"
import { ShotstackError, ShotstackErrorCode } from "@modules/integrations/shotstack"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import { SOUND_SPEC } from "@tests/fixtures/builders/video-compose.builder"
import { proofOf, ProviderRegistryErrorCode, providerRefusalDetail, providerRefusalReason } from "@modules/domain/provider-registry"
import { ProviderSandboxError, ProviderSandboxErrorCode, type SandboxCase } from "@modules/domain/provider-sandbox"
import type { ComposeSpec, RenderState } from "@modules/domain/video-compose"
import {
    SHOTSTACK_SANDBOX_CATALOGUE,
    SHOTSTACK_SANDBOX_FAILED_MESSAGE,
    SHOTSTACK_SANDBOX_NEVER_STARTED_ID,
    SHOTSTACK_SANDBOX_NOT_FOUND_MESSAGE,
    SHOTSTACK_SANDBOX_REJECTED_MESSAGE,
    SHOTSTACK_SANDBOX_OUTPUT_URL,
} from "./shotstack-sandbox.catalogue"
import { ShotstackSandboxComposeService } from "./shotstack-sandbox-compose.service"

const account = sandboxAccount({ provider: "shotstack" })
const connection = connectionRecord({ provider: "shotstack", id: account.id, workspaceId: account.workspaceId, sandbox: true })

const build = () => {
    const { sandbox } = sandboxServiceOf(account)
    return { sandbox, service: new ShotstackSandboxComposeService(sandbox) }
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

describe("ShotstackSandboxComposeService > start and status", () => {
    it("SHOTSTACK-1: accepts a render, then reads queued, rendering, rendering, done with the video address, and holds done", async () => {
        const { sandbox, service } = build()

        const started = await service.start(connection, SOUND_SPEC, { url: "https://hooks.test/x" })

        expect(started).toEqual({ renderId: "SBX-SHOTSTACK-000001" })
        const polls = [
            await service.statusOf(connection, started.renderId),
            await service.statusOf(connection, started.renderId),
            await service.statusOf(connection, started.renderId),
            await service.statusOf(connection, started.renderId),
            await service.statusOf(connection, started.renderId),
        ]
        expect(polls).toEqual([
            { renderId: started.renderId, status: "queued" },
            { renderId: started.renderId, status: "rendering" },
            { renderId: started.renderId, status: "rendering" },
            { renderId: started.renderId, status: "done", outputUrl: SHOTSTACK_SANDBOX_OUTPUT_URL },
            { renderId: started.renderId, status: "done", outputUrl: SHOTSTACK_SANDBOX_OUTPUT_URL },
        ])
        expect(await sandbox.calls(account, "start")).toHaveLength(1)
        expect(await sandbox.calls(account, "statusOf")).toHaveLength(5)
    })

    it("takes the default case (a render that completes) when the account picked none, with the next running id", async () => {
        const { service } = build()

        await service.start(connection, SOUND_SPEC, null)
        const second = await service.start(connection, SOUND_SPEC, null)

        expect(second).toEqual({ renderId: "SBX-SHOTSTACK-000002" })
        await service.statusOf(connection, second.renderId)
        await service.statusOf(connection, second.renderId)
        await service.statusOf(connection, second.renderId)
        await expect(service.statusOf(connection, second.renderId)).resolves.toMatchObject({ status: "done" })
    })

    it("SHOTSTACK-2: a render that later fails ends at failed with the provider's words", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "SHOTSTACK-2")
        const { renderId } = await service.start(connection, SOUND_SPEC, null)

        await service.statusOf(connection, renderId)
        await service.statusOf(connection, renderId)

        await expect(service.statusOf(connection, renderId)).resolves.toEqual({ renderId, status: "failed", error: SHOTSTACK_SANDBOX_FAILED_MESSAGE })
    })

    it("SHOTSTACK-3: an Edit refused at start is the live refusal (rejected, not_sent, the hint) and starts nothing", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "SHOTSTACK-3")

        const cause = await failure(service.start(connection, SOUND_SPEC, null))

        expect(providerRefusalReason(cause)).toBe("rejected")
        expect(providerRefusalDetail(cause)).toBe(SHOTSTACK_SANDBOX_REJECTED_MESSAGE)
        expect(proofOf(cause)).toBe("not_sent")
        await pick(sandbox, "start", "SHOTSTACK-1")
        const next = await service.start(connection, SOUND_SPEC, null)
        expect(next.renderId).toBe("SBX-SHOTSTACK-000002")
        await expect(failure(service.statusOf(connection, "SBX-SHOTSTACK-000001"))).resolves.toMatchObject({ code: ProviderRegistryErrorCode.RefusedNotFound })
        expect((await sandbox.calls(account, "start"))[0]?.result).toEqual({ outcome: "threw", error: ProviderRegistryErrorCode.RefusedRejected })
    })

    it("SHOTSTACK-4: an unknown outcome throws the unknown proof AFTER the render exists, so its status can be read", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "SHOTSTACK-4")

        const cause = await failure(service.start(connection, SOUND_SPEC, null))

        expect(proofOf(cause)).toBe("unknown")
        await expect(service.statusOf(connection, "SBX-SHOTSTACK-000001")).resolves.toEqual({ renderId: "SBX-SHOTSTACK-000001", status: "queued" })
    })

    it("refuses a spec the account's environment cannot render as the live does (rejected, not_sent), before any case", async () => {
        const { service } = build()
        const spec: ComposeSpec = { ...SOUND_SPEC, clips: [{ fileUrl: "https://sandbox.nivo.test/clips/completes.mp4", trimMs: { fromMs: 0, toMs: 700_000 } }] }

        const cause = await failure(service.start(connection, spec, null))

        expect(providerRefusalReason(cause)).toBe("rejected")
        expect(providerRefusalDetail(cause)).toContain("clips: 700000 ms")
        expect(proofOf(cause)).toBe("not_sent")
    })

    it("SHOTSTACK-5: a status read of a render the account does not hold is the not_found refusal", async () => {
        const { service } = build()

        const cause = await failure(service.statusOf(connection, "SBX-SHOTSTACK-000009"))

        expect(providerRefusalReason(cause)).toBe("not_found")
        expect(providerRefusalDetail(cause)).toBe(SHOTSTACK_SANDBOX_NOT_FOUND_MESSAGE)
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
        const other = sandboxAccount({ provider: "shotstack", id: "sbx-conn-2" })
        const { sandbox } = sandboxServiceOf(account, other)
        const service = new ShotstackSandboxComposeService(sandbox)
        const otherConnection = connectionRecord({ provider: "shotstack", id: other.id, workspaceId: other.workspaceId, sandbox: true })
        await service.start(connection, SOUND_SPEC, null)

        await expect(service.start(otherConnection, SOUND_SPEC, null)).resolves.toEqual({ renderId: "SBX-SHOTSTACK-000001" })
    })
})

describe("ShotstackSandboxComposeService > the webhook, the frame and the law", () => {
    it("maps the webhook cases with the live completion mapper and gives the provider's real route", async () => {
        const { sandbox, service } = build()
        const inbound = SHOTSTACK_SANDBOX_CATALOGUE.cases.filter((one) => one.inbound !== undefined)

        expect(inbound.map((one) => one.id)).toEqual(["SHOTSTACK-6", "SHOTSTACK-7", "SHOTSTACK-16", "SHOTSTACK-17", "SHOTSTACK-18"])
        expect(service.completionOf(await bodyOf(sandbox, inbound[0]))).toEqual({ renderId: "SBX-SHOTSTACK-000001", status: "done", outputUrl: SHOTSTACK_SANDBOX_OUTPUT_URL })
        expect(service.completionOf(await bodyOf(sandbox, inbound[1]))).toEqual({
            renderId: "SBX-SHOTSTACK-000002",
            status: "failed",
            error: SHOTSTACK_SANDBOX_FAILED_MESSAGE,
        })
        for (const one of inbound) {
            expect(one.inbound?.path("c-9")).toBe("api/connections/video-render/shotstack/c-9/sandbox")
            expect(one.inbound?.trigger).toBe("render.completed")
        }
        expect(service.proves()).toBe(true)
        expect(service.webhook).toEqual({ signatureHeader: null, timestampHeader: null })
    })

    it("has unique ids of the form SHOTSTACK-<n>", () => {
        const ids = SHOTSTACK_SANDBOX_CATALOGUE.cases.map((one) => one.id)

        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.every((id) => /^SHOTSTACK-\d+$/.test(id))).toBe(true)
        expect(SHOTSTACK_SANDBOX_CATALOGUE.provider).toBe("shotstack")
    })

    it("refuses a live account (PROVIDER_SANDBOX_LIVE_ACCOUNT)", async () => {
        const live = sandboxAccount({ provider: "shotstack", id: "live-1", sandbox: false })
        const { sandbox } = sandboxServiceOf(live)
        const service = new ShotstackSandboxComposeService(sandbox)

        const cause = await failure(service.start(connectionRecord({ provider: "shotstack", id: live.id }), SOUND_SPEC, null))

        expect(cause).toBeInstanceOf(ProviderSandboxError)
        expect(cause).toMatchObject({ code: ProviderSandboxErrorCode.LiveAccount })
    })

    it("is refused with the switch off (PROVIDER_SANDBOX_OFF)", async () => {
        const { sandbox } = sandboxServiceOff(account)
        const service = new ShotstackSandboxComposeService(sandbox)

        await expect(failure(service.statusOf(connection, "x"))).resolves.toMatchObject({ code: ProviderSandboxErrorCode.Off })
    })

    it("reaches no network: one constructor argument and no client or host in its source", () => {
        const source = readFileSync(__filename.replace(".spec.ts", ".ts"), "utf8")

        expect(ShotstackSandboxComposeService.length).toBe(1)
        expect(source).not.toContain("@modules/integrations")
        expect(source).not.toContain("http")
    })
})

describe("ShotstackSandboxComposeService > the situations of the SBX standard (next case, the live twin's answers)", () => {
    it("SHOTSTACK-8: a render that never finishes: reads see queued, then rendering for ever (never done, never failed)", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "SHOTSTACK-8")
        const { renderId } = await service.start(connection, SOUND_SPEC, null)

        const reads: Array<RenderState> = []
        for (let one = 0; one < 8; one += 1) reads.push(await service.statusOf(connection, renderId))

        expect(reads.map((read) => read.status)).toEqual(["queued", "rendering", "rendering", "rendering", "rendering", "rendering", "rendering", "rendering"])
        expect(reads.every((read) => read.outputUrl === undefined && read.error === undefined)).toBe(true)
    })

    it("SHOTSTACK-9: the key refused at start is the live auth_refused refusal (not_sent); no render exists", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "SHOTSTACK-9")

        const cause = await failure(service.start(connection, SOUND_SPEC, null))

        expect(providerRefusalReason(cause)).toBe("auth_refused")
        expect(proofOf(cause)).toBe("not_sent")
        await pick(sandbox, "start", "SHOTSTACK-1")
        await expect(service.start(connection, SOUND_SPEC, null)).resolves.toEqual({ renderId: "SBX-SHOTSTACK-000002" })
    })

    it("SHOTSTACK-10: a 429 at start is the live rate-limit error proving not_sent, sticky until the account picks another case, and starts nothing", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "SHOTSTACK-10")

        const first = await failure(service.start(connection, SOUND_SPEC, null))
        const second = await failure(service.start(connection, SOUND_SPEC, null))

        for (const cause of [first, second]) {
            expect(cause).toBeInstanceOf(ShotstackError)
            expect(cause).toMatchObject({ code: ShotstackErrorCode.RateLimited, params: { status: 429, retryAfterSeconds: 30 } })
            expect(proofOf(cause)).toBe("not_sent")
        }
        await pick(sandbox, "start", "SHOTSTACK-1")
        await expect(service.start(connection, SOUND_SPEC, null)).resolves.toEqual({ renderId: "SBX-SHOTSTACK-000003" })
    })

    it("SHOTSTACK-11: no answer at start is the live `Unreachable` proving unknown, and NOTHING was started (no render of that id)", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "SHOTSTACK-11")

        const cause = await failure(service.start(connection, SOUND_SPEC, null))

        expect(cause).toBeInstanceOf(ShotstackError)
        expect(cause).toMatchObject({ code: ShotstackErrorCode.Unreachable })
        expect(proofOf(cause)).toBe("unknown")
        await expect(failure(service.statusOf(connection, "SBX-SHOTSTACK-000001"))).resolves.toMatchObject({ code: ProviderRegistryErrorCode.RefusedNotFound })
    })

    it("SHOTSTACK-4 differs from SHOTSTACK-11 only by what was applied: the render exists", async () => {
        const { sandbox, service } = build()
        await pick(sandbox, "start", "SHOTSTACK-4")
        await failure(service.start(connection, SOUND_SPEC, null))

        await expect(service.statusOf(connection, "SBX-SHOTSTACK-000001")).resolves.toMatchObject({ status: "queued" })
    })

    it("SHOTSTACK-12 is the default read (a started render's life); SHOTSTACK-5 forces not_found even for a render the account holds", async () => {
        const { sandbox, service } = build()
        const { renderId } = await service.start(connection, SOUND_SPEC, null)
        await pick(sandbox, "statusOf", "SHOTSTACK-5")

        const cause = await failure(service.statusOf(connection, renderId))

        expect(providerRefusalReason(cause)).toBe("not_found")
        await pick(sandbox, "statusOf", "SHOTSTACK-12")
        await expect(service.statusOf(connection, renderId)).resolves.toEqual({ renderId, status: "queued" })
    })

    it("SHOTSTACK-13 / 14 / 15: a status read refused for the key, answered 429, or with no answer fails as the live twin does", async () => {
        const { sandbox, service } = build()
        const { renderId } = await service.start(connection, SOUND_SPEC, null)

        await pick(sandbox, "statusOf", "SHOTSTACK-13")
        const refused = await failure(service.statusOf(connection, renderId))
        await pick(sandbox, "statusOf", "SHOTSTACK-14")
        const limited = await failure(service.statusOf(connection, renderId))
        await pick(sandbox, "statusOf", "SHOTSTACK-15")
        const silent = await failure(service.statusOf(connection, renderId))

        expect(providerRefusalReason(refused)).toBe("auth_refused")
        expect(proofOf(refused)).toBe("not_sent")
        expect(limited).toMatchObject({ code: ShotstackErrorCode.RateLimited })
        expect(proofOf(limited)).toBe("not_sent")
        expect(silent).toMatchObject({ code: ShotstackErrorCode.Unreachable })
        expect(proofOf(silent)).toBe("unknown")
        await pick(sandbox, "statusOf", "SHOTSTACK-12")
        await expect(service.statusOf(connection, renderId)).resolves.toEqual({ renderId, status: "queued" })
    })

    it("SHOTSTACK-16 / 17 / 18: the callbacks the live mapper reads as no finished render (another action, no video) or as a render nobody started", async () => {
        const { sandbox, service } = build()
        const byId = (id: string): SandboxCase | undefined => SHOTSTACK_SANDBOX_CATALOGUE.cases.find((one) => one.id === id)

        expect(service.completionOf(await bodyOf(sandbox, byId("SHOTSTACK-16")))).toBeNull()
        expect(service.completionOf(await bodyOf(sandbox, byId("SHOTSTACK-17")))).toBeNull()
        expect(service.completionOf(await bodyOf(sandbox, byId("SHOTSTACK-18")))).toEqual({
            renderId: SHOTSTACK_SANDBOX_NEVER_STARTED_ID,
            status: "done",
            outputUrl: SHOTSTACK_SANDBOX_OUTPUT_URL,
        })
        await expect(failure(service.statusOf(connection, SHOTSTACK_SANDBOX_NEVER_STARTED_ID))).resolves.toMatchObject({ code: ProviderRegistryErrorCode.RefusedNotFound })
    })

    it("every outbound case has an outcome tag and each operation exactly one default, tagged ok; the tag order picks the plain case first", () => {
        const outbound = SHOTSTACK_SANDBOX_CATALOGUE.cases.filter((one) => one.operation !== undefined)
        for (const operation of ["start", "statusOf"]) {
            const own = outbound.filter((one) => one.operation === operation)
            expect(own.filter((one) => one.default === true).map((one) => one.outcome)).toEqual(["ok"])
            expect(own.every((one) => one.outcome !== undefined)).toBe(true)
        }
        const firstOf = (outcome: string): string | undefined => outbound.find((one) => one.operation === "start" && one.outcome === outcome)?.id
        expect(["ok", "refused", "transient", "timeout"].map(firstOf)).toEqual(["SHOTSTACK-1", "SHOTSTACK-3", "SHOTSTACK-10", "SHOTSTACK-11"])
    })
})
