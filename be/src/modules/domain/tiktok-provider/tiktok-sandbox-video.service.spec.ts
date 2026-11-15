import { readFileSync } from "node:fs"
import type { TiktokPublishRequest } from "@modules/domain/provider-registry"
import { proofOf, providerRefusalDetail, providerRefusalReason } from "@modules/domain/provider-registry"
import { ProviderSandboxError, ProviderSandboxErrorCode } from "@modules/domain/provider-sandbox"
import { TiktokError, TiktokErrorCode } from "@modules/integrations/tiktok"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import {
    TIKTOK_CASE,
    TIKTOK_CREATOR_OPERATION,
    TIKTOK_PUBLISH_OPERATION,
    TIKTOK_SANDBOX_CASES,
    TIKTOK_SANDBOX_CATALOGUE,
    TIKTOK_SANDBOX_CREATOR,
    TIKTOK_STATUS_OPERATION,
} from "./tiktok-sandbox.catalogue"
import { TiktokSandboxVideoService } from "./tiktok-sandbox-video.service"
import { tiktokFailureOf } from "./tiktok-failure.policy"

const build = () => {
    const account = sandboxAccount({ provider: "tiktok" })
    const { sandbox } = sandboxServiceOf(account)
    const connection = connectionRecord({ provider: "tiktok", id: account.id, workspaceId: account.workspaceId, sandbox: true })
    return { account, sandbox, connection, tiktok: new TiktokSandboxVideoService(sandbox) }
}

const failure = (work: Promise<unknown>): Promise<unknown> => Promise.resolve(work.then(() => undefined, (cause: unknown) => cause))
const post = (title: string | null, overrides: Partial<TiktokPublishRequest> = {}): TiktokPublishRequest => ({
    source: { kind: "url", videoUrl: "https://shop.test/a.mp4" },
    privacyLevel: "PUBLIC_TO_EVERYONE",
    title,
    disableDuet: null,
    disableStitch: null,
    disableComment: null,
    coverTimestampMs: null,
    brandContentToggle: null,
    brandOrganicToggle: null,
    isAigc: null,
    ...overrides,
})
const PUBLISH_1 = "sbx-tt-publish-000001"
const picked = (ctx: ReturnType<typeof build>, operation: string, caseId: string) => ctx.sandbox.setNextCase(ctx.account, operation, caseId)
/** What the live adapter throws for a client failure of that code (the live mapping of `tiktok-video.service.ts`). */
const liveProof = (code: TiktokErrorCode) => proofOf(tiktokFailureOf(new TiktokError({ code, params: {} })))

describe("TiktokSandboxVideoService", () => {
    it("TIKTOK-1 (default): answers the fixed creator", async () => {
        const { tiktok, connection } = build()

        await expect(tiktok.creator(connection)).resolves.toEqual(TIKTOK_SANDBOX_CREATOR)
    })

    it("TIKTOK-2 (default): accepts a post, then its status walks downloading, then published with the public post id", async () => {
        const { tiktok, connection } = build()

        await expect(tiktok.publish(connection, post("Clip bán hàng"))).resolves.toEqual({ publishId: PUBLISH_1 })
        await expect(tiktok.status(connection, PUBLISH_1)).resolves.toEqual({ publishId: PUBLISH_1, state: "pending", providerStatus: "PROCESSING_DOWNLOAD", failReason: null, postIds: [] })
        await expect(tiktok.status(connection, PUBLISH_1)).resolves.toEqual({
            publishId: PUBLISH_1,
            state: "published",
            providerStatus: "PUBLISH_COMPLETE",
            failReason: null,
            postIds: ["7300000000000001"],
        })
        await expect(tiktok.status(connection, PUBLISH_1)).resolves.toMatchObject({ state: "published" })
    })

    it("picks nothing from the request's own words: the old magic titles are ordinary posts now", async () => {
        const { tiktok, connection } = build()

        for (const title of ["Clip quá dài", "Token TikTok hết hạn", "Clip lỗi xử lý"]) {
            await expect(tiktok.publish(connection, post(title))).resolves.toMatchObject({ publishId: expect.stringContaining("sbx-tt-publish-") })
        }
        await expect(tiktok.status(connection, "sbx-tt-publish-000003")).resolves.toMatchObject({ state: "pending", providerStatus: "PROCESSING_DOWNLOAD" })
    })

    it("TIKTOK-6: the post is accepted and its later status is FAILED with TikTok's reason, and stays failed (a failed job)", async () => {
        const ctx = build()
        const { tiktok, connection } = ctx
        await picked(ctx, TIKTOK_PUBLISH_OPERATION, TIKTOK_CASE.processingFailed)

        await expect(tiktok.publish(connection, post("x"))).resolves.toEqual({ publishId: PUBLISH_1 })
        await expect(tiktok.status(connection, PUBLISH_1)).resolves.toMatchObject({ state: "pending", providerStatus: "PROCESSING_UPLOAD" })
        const failed = { publishId: PUBLISH_1, state: "failed", providerStatus: "FAILED", failReason: "file_format_check_failed", postIds: [] }
        await expect(tiktok.status(connection, PUBLISH_1)).resolves.toEqual(failed)
        await expect(tiktok.status(connection, PUBLISH_1)).resolves.toEqual(failed)
    })

    it("TIKTOK-11: the post is accepted and its status stays PROCESSING_UPLOAD on every read, for ever (a job that never finishes)", async () => {
        const ctx = build()
        const { tiktok, connection } = ctx
        await picked(ctx, TIKTOK_PUBLISH_OPERATION, TIKTOK_CASE.neverFinishes)

        await tiktok.publish(connection, post("x"))
        for (let read = 0; read < 5; read += 1) {
            await expect(tiktok.status(connection, PUBLISH_1)).resolves.toMatchObject({ state: "pending", providerStatus: "PROCESSING_UPLOAD", postIds: [] })
        }
    })

    it("TIKTOK-12: the status reads PUBLISH_COMPLETE but TikTok withholds the public post id: published with no post ids", async () => {
        const ctx = build()
        const { tiktok, connection } = ctx
        await picked(ctx, TIKTOK_PUBLISH_OPERATION, TIKTOK_CASE.completeNoIds)

        await tiktok.publish(connection, post("x"))
        await tiktok.status(connection, PUBLISH_1)
        await expect(tiktok.status(connection, PUBLISH_1)).resolves.toMatchObject({ state: "published", providerStatus: "PUBLISH_COMPLETE", postIds: [] })
    })

    it("refuses a privacy level the creator does not list, whatever case is picked (TIKTOK-3, what TikTok answers)", async () => {
        const { tiktok, connection, sandbox, account } = build()

        const error = await failure(tiktok.publish(connection, post("x", { privacyLevel: "FOLLOWER_OF_CREATOR" })))

        expect(providerRefusalReason(error)).toBe("rejected")
        expect(providerRefusalDetail(error)).toBe("privacy_level_option_mismatch")
        expect(proofOf(error)).toBe("not_sent")
        expect((await sandbox.calls(account, TIKTOK_PUBLISH_OPERATION))[0]?.result.outcome).toBe("threw")
    })

    it.each([
        [TIKTOK_CASE.privacyMismatch, "rejected", "privacy_level_option_mismatch"],
        [TIKTOK_CASE.tooLong, "rejected", "video_duration_too_long"],
        [TIKTOK_CASE.authRefused, "auth_refused", "access_token_invalid"],
        [TIKTOK_CASE.refreshRefused, "auth_refused", "expired"],
    ] as const)("%s (sticky) refuses as the live twin refuses it (%s: %s, not_sent) and starts nothing", async (caseId, reason, detail) => {
        const ctx = build()
        const { tiktok, connection } = ctx
        await picked(ctx, TIKTOK_PUBLISH_OPERATION, caseId)

        for (const attempt of ["a", "b"]) {
            const error = await failure(tiktok.publish(connection, post(attempt)))
            expect(providerRefusalReason(error)).toBe(reason)
            expect(providerRefusalDetail(error)).toBe(detail)
            expect(proofOf(error)).toBe("not_sent")
        }
        expect(providerRefusalReason(await failure(tiktok.status(connection, PUBLISH_1)))).toBe("not_found")
        await picked(ctx, TIKTOK_PUBLISH_OPERATION, TIKTOK_CASE.accepted)
        await expect(tiktok.publish(connection, post("c"))).resolves.toEqual({ publishId: "sbx-tt-publish-000003" })
    })

    it("TIKTOK-13 (no app client), 14 (429), 15 (a 5xx), 16 (no answer) throw the SAME failures as the live adapter (proof not_sent / not_sent / unknown / unknown)", async () => {
        const ctx = build()
        const { tiktok, connection } = ctx
        const attempt = async (caseId: string) => {
            await picked(ctx, TIKTOK_PUBLISH_OPERATION, caseId)
            return await failure(tiktok.publish(connection, post("x")))
        }

        const notConfigured = await attempt(TIKTOK_CASE.notConfigured)
        const limited = await attempt(TIKTOK_CASE.rateLimited)
        const outage = await attempt(TIKTOK_CASE.serverError)
        const silent = await attempt(TIKTOK_CASE.timeout)

        expect(providerRefusalReason(notConfigured)).toBe("not_available")
        expect(providerRefusalDetail(notConfigured)).toBe("app client")
        expect(limited).toMatchObject({ code: TiktokErrorCode.RateLimited })
        expect(outage).toMatchObject({ code: TiktokErrorCode.Failed })
        expect(silent).toMatchObject({ code: TiktokErrorCode.Unreachable })
        expect([notConfigured, limited, outage, silent].map((one) => proofOf(one))).toEqual([
            "not_sent",
            liveProof(TiktokErrorCode.RateLimited),
            liveProof(TiktokErrorCode.Failed),
            liveProof(TiktokErrorCode.Unreachable),
        ])
        expect(providerRefusalReason(await failure(tiktok.status(connection, PUBLISH_1)))).toBe("not_found")
    })

    it("TIKTOK-17: no answer, but the post WAS started: a status read of the next running publish id finds it", async () => {
        const ctx = build()
        const { tiktok, connection } = ctx
        await picked(ctx, TIKTOK_PUBLISH_OPERATION, TIKTOK_CASE.appliedNoAnswer)

        const error = await failure(tiktok.publish(connection, post("x")))

        expect(error).toMatchObject({ code: TiktokErrorCode.Unreachable })
        expect(proofOf(error)).toBe("unknown")
        await expect(tiktok.status(connection, PUBLISH_1)).resolves.toMatchObject({ state: "pending", providerStatus: "PROCESSING_DOWNLOAD" })
    })

    it("answers the status read's own outcomes: TIKTOK-19 auth refused, 20 rate limit, 21 no answer, 7 not found; 18 goes back", async () => {
        const ctx = build()
        const { tiktok, connection } = ctx
        await tiktok.publish(connection, post("x"))

        await picked(ctx, TIKTOK_STATUS_OPERATION, TIKTOK_CASE.statusAuthRefused)
        expect(providerRefusalReason(await failure(tiktok.status(connection, PUBLISH_1)))).toBe("auth_refused")
        await picked(ctx, TIKTOK_STATUS_OPERATION, TIKTOK_CASE.statusRateLimited)
        expect(await failure(tiktok.status(connection, PUBLISH_1))).toMatchObject({ code: TiktokErrorCode.RateLimited })
        await picked(ctx, TIKTOK_STATUS_OPERATION, TIKTOK_CASE.statusTimeout)
        expect(await failure(tiktok.status(connection, PUBLISH_1))).toMatchObject({ code: TiktokErrorCode.Unreachable })
        await picked(ctx, TIKTOK_STATUS_OPERATION, TIKTOK_CASE.statusNotFound)
        expect(providerRefusalReason(await failure(tiktok.status(connection, PUBLISH_1)))).toBe("not_found")
        await picked(ctx, TIKTOK_STATUS_OPERATION, TIKTOK_CASE.statusRead)
        await expect(tiktok.status(connection, PUBLISH_1)).resolves.toMatchObject({ state: "pending" })
    })

    it("answers the creator read's own outcomes: TIKTOK-8 auth refused, 9 rate limit, 10 no answer", async () => {
        const ctx = build()
        const { tiktok, connection } = ctx

        await picked(ctx, TIKTOK_CREATOR_OPERATION, TIKTOK_CASE.creatorAuthRefused)
        expect(providerRefusalReason(await failure(tiktok.creator(connection)))).toBe("auth_refused")
        await picked(ctx, TIKTOK_CREATOR_OPERATION, TIKTOK_CASE.creatorRateLimited)
        const limited = await failure(tiktok.creator(connection))
        expect(limited).toMatchObject({ code: TiktokErrorCode.RateLimited })
        expect(proofOf(limited)).toBe(liveProof(TiktokErrorCode.RateLimited))
        await picked(ctx, TIKTOK_CREATOR_OPERATION, TIKTOK_CASE.creatorTimeout)
        expect(await failure(tiktok.creator(connection))).toMatchObject({ code: TiktokErrorCode.Unreachable })
        await picked(ctx, TIKTOK_CREATOR_OPERATION, TIKTOK_CASE.creator)
        await expect(tiktok.creator(connection)).resolves.toEqual(TIKTOK_SANDBOX_CREATOR)
    })

    it("answers not_found (not_sent) for a publish id the account never started (TIKTOK-7 by its own default)", async () => {
        const { tiktok, connection } = build()

        const error = await failure(tiktok.status(connection, "nope"))

        expect(providerRefusalReason(error)).toBe("not_found")
        expect(proofOf(error)).toBe("not_sent")
    })

    it("takes one logged call per request, keyed by title or publish id, under the port's own operation words", async () => {
        const { tiktok, connection, sandbox, account } = build()

        await tiktok.creator(connection)
        await tiktok.publish(connection, post("Clip bán hàng"))
        await tiktok.status(connection, PUBLISH_1)

        expect((await sandbox.calls(account)).map((call) => [call.operation, call.key])).toEqual([
            ["creator", ""],
            ["publish", "Clip bán hàng"],
            ["status", PUBLISH_1],
        ])
    })

    it("is deterministic: two fresh accounts walk the same ids and words", async () => {
        const one = build()
        const two = build()

        expect(await one.tiktok.publish(one.connection, post("Clip"))).toEqual(await two.tiktok.publish(two.connection, post("Clip")))
        expect(await one.tiktok.status(one.connection, PUBLISH_1)).toEqual(await two.tiktok.status(two.connection, PUBLISH_1))
    })

    it("refuses a live account and a switched-off sandbox", async () => {
        const { tiktok } = build()
        const live = await failure(tiktok.creator(connectionRecord({ provider: "tiktok", id: "live-1" })))
        expect(live).toBeInstanceOf(ProviderSandboxError)
        expect((live as ProviderSandboxError).code).toBe(ProviderSandboxErrorCode.LiveAccount)

        const account = sandboxAccount({ provider: "tiktok" })
        const off = new TiktokSandboxVideoService(sandboxServiceOff(account).sandbox)
        const refused = await failure(off.creator(connectionRecord({ provider: "tiktok", id: account.id, sandbox: true })))
        expect((refused as ProviderSandboxError).code).toBe(ProviderSandboxErrorCode.Off)
    })

    it("has a catalogue of unique TIKTOK-<n> ids on three operations, ONE default tagged ok per operation, every case tagged, and no inbound case (a post is polled)", () => {
        const ids = TIKTOK_SANDBOX_CATALOGUE.cases.map((one) => one.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.every((id) => /^TIKTOK-\d+$/.test(id))).toBe(true)
        expect(TIKTOK_SANDBOX_CATALOGUE.provider).toBe("tiktok")
        expect(Object.values(TIKTOK_CASE).toSorted()).toEqual([...ids].toSorted())
        expect(TIKTOK_SANDBOX_CASES.every((one) => one.inbound === undefined && one.outcome !== undefined)).toBe(true)
        for (const operation of [TIKTOK_CREATOR_OPERATION, TIKTOK_PUBLISH_OPERATION, TIKTOK_STATUS_OPERATION]) {
            expect(TIKTOK_SANDBOX_CASES.filter((one) => one.operation === operation && one.default === true).map((one) => one.outcome)).toEqual(["ok"])
        }
    })

    it("reaches no host: one constructor parameter and no integration or network word in its source", () => {
        expect(TiktokSandboxVideoService.length).toBe(1)
        const source = readFileSync(__filename.replace(".spec.ts", ".ts"), "utf8")
        expect(source).not.toContain("@modules/integrations")
        expect(source).not.toContain("http")
    })
})
