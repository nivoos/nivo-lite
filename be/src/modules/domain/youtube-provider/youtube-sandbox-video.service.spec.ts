import { readFileSync } from "node:fs"
import type { YoutubeVideoRequest } from "@modules/domain/provider-registry"
import { proofOf, providerRefusalDetail, providerRefusalReason } from "@modules/domain/provider-registry"
import { ProviderSandboxError, ProviderSandboxErrorCode } from "@modules/domain/provider-sandbox"
import { YoutubeError, YoutubeErrorCode } from "@modules/integrations/youtube"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import {
    YOUTUBE_CASE,
    YOUTUBE_PUBLISH_OPERATION,
    YOUTUBE_SANDBOX_CASES,
    YOUTUBE_SANDBOX_CATALOGUE,
    YOUTUBE_STATUS_OPERATION,
} from "./youtube-sandbox.catalogue"
import { YoutubeSandboxVideoService } from "./youtube-sandbox-video.service"
import { youtubeFailureOf } from "./youtube-failure.policy"

const build = () => {
    const account = sandboxAccount({ provider: "google" })
    const { sandbox } = sandboxServiceOf(account)
    const connection = connectionRecord({ provider: "google", id: account.id, workspaceId: account.workspaceId, sandbox: true })
    return { account, sandbox, connection, youtube: new YoutubeSandboxVideoService(sandbox) }
}

const failure = (work: Promise<unknown>): Promise<unknown> => Promise.resolve(work.then(() => undefined, (cause: unknown) => cause))
const video = (title: string, overrides: Partial<YoutubeVideoRequest> = {}): YoutubeVideoRequest => ({
    video: { fileId: "file-1" },
    title,
    description: "",
    tags: [],
    categoryId: null,
    privacyStatus: null,
    publishAt: null,
    madeForKids: null,
    notifySubscribers: null,
    thumbnail: null,
    playlistId: null,
    ...overrides,
})
const VIDEO_1 = "sbx-yt-video-000001"
const picked = (ctx: ReturnType<typeof build>, operation: string, caseId: string) => ctx.sandbox.setNextCase(ctx.account, operation, caseId)
/** What the live adapter throws for a client failure of that code (the live mapping of `youtube-video.service.ts`). */
const liveProof = (code: YoutubeErrorCode) => proofOf(youtubeFailureOf(new YoutubeError({ code, params: {} })))

describe("YoutubeSandboxVideoService", () => {
    it("YOUTUBE-1 (default): accepts an upload, then its status walks uploaded, then processed", async () => {
        const { youtube, connection } = build()

        await expect(youtube.publish("ws-1", connection, video("Video giới thiệu", { privacyStatus: "unlisted" }))).resolves.toEqual({
            videoId: VIDEO_1,
            state: "pending",
            uploadStatus: "uploaded",
            reason: null,
            privacyStatus: "unlisted",
            processingStatus: null,
            playlistItemId: null,
            playlistFailure: null,
        })
        await expect(youtube.status(connection, VIDEO_1)).resolves.toMatchObject({ state: "pending", uploadStatus: "uploaded", processingStatus: "processing", privacyStatus: "unlisted" })
        await expect(youtube.status(connection, VIDEO_1)).resolves.toMatchObject({ state: "done", uploadStatus: "processed", processingStatus: "succeeded", reason: null })
        await expect(youtube.status(connection, VIDEO_1)).resolves.toMatchObject({ state: "done" })
    })

    it("picks nothing from the request's own words: the old magic titles are ordinary uploads now", async () => {
        const { youtube, connection } = build()

        for (const title of ["Video lỗi xử lý", "Video vi phạm bản quyền", "Video quá lớn", "Token Google hết hạn"]) {
            await expect(youtube.publish("ws-1", connection, video(title))).resolves.toMatchObject({ state: "pending", uploadStatus: "uploaded" })
        }
        await expect(youtube.status(connection, "sbx-yt-video-000004")).resolves.toMatchObject({ uploadStatus: "uploaded" })
        await expect(youtube.status(connection, "sbx-yt-video-000004")).resolves.toMatchObject({ uploadStatus: "processed" })
    })

    it("YOUTUBE-2: adds the upload to the playlist it names and answers the playlist item id", async () => {
        const { youtube, connection } = build()

        await expect(youtube.publish("ws-1", connection, video("Video", { playlistId: "PL-1" }))).resolves.toMatchObject({ playlistItemId: "sbx-yt-item-000001", playlistFailure: null })
    })

    it("YOUTUBE-8: the video exists but the playlist add failed: playlistFailure not_found (partly done); a request that names no playlist is answered like the default", async () => {
        const ctx = build()
        const { youtube, connection } = ctx
        await picked(ctx, YOUTUBE_PUBLISH_OPERATION, YOUTUBE_CASE.playlistMissing)

        await expect(youtube.publish("ws-1", connection, video("Video", { playlistId: "PL-KHONG-CO" }))).resolves.toMatchObject({ videoId: VIDEO_1, playlistItemId: null, playlistFailure: "not_found" })
        await expect(youtube.publish("ws-1", connection, video("Video"))).resolves.toMatchObject({ playlistItemId: null, playlistFailure: null })
        await expect(youtube.status(connection, VIDEO_1)).resolves.toMatchObject({ uploadStatus: "uploaded" })
    })

    it.each([
        [YOUTUBE_CASE.processingFailed, "failed", "failed", "codec"],
        [YOUTUBE_CASE.copyright, "rejected", "terminated", "copyright"],
        [YOUTUBE_CASE.deleted, "deleted", "terminated", null],
    ] as const)("%s: the upload is accepted and its later status reads %s (processing %s, reason %s), and stays there (a failed job)", async (caseId, uploadStatus, processingStatus, reason) => {
        const ctx = build()
        const { youtube, connection } = ctx
        await picked(ctx, YOUTUBE_PUBLISH_OPERATION, caseId)

        await youtube.publish("ws-1", connection, video("x"))
        await expect(youtube.status(connection, VIDEO_1)).resolves.toMatchObject({ state: "pending", uploadStatus: "uploaded", processingStatus: "processing" })
        const end = { state: "failed", uploadStatus, processingStatus, reason }
        await expect(youtube.status(connection, VIDEO_1)).resolves.toMatchObject(end)
        await expect(youtube.status(connection, VIDEO_1)).resolves.toMatchObject(end)
    })

    it("YOUTUBE-10: the upload is accepted and its status stays uploaded / processing on every read, for ever (a job that never finishes)", async () => {
        const ctx = build()
        const { youtube, connection } = ctx
        await picked(ctx, YOUTUBE_PUBLISH_OPERATION, YOUTUBE_CASE.neverFinishes)

        await youtube.publish("ws-1", connection, video("x"))
        for (let read = 0; read < 5; read += 1) {
            await expect(youtube.status(connection, VIDEO_1)).resolves.toMatchObject({ state: "pending", uploadStatus: "uploaded", processingStatus: "processing" })
        }
    })

    it.each([
        [YOUTUBE_CASE.fileNotFound, "not_found", "video file"],
        [YOUTUBE_CASE.authRefused, "auth_refused", "Invalid Credentials"],
        [YOUTUBE_CASE.thumbnail, "not_available", "thumbnails.set: docs-missing"],
    ] as const)("%s (sticky) refuses as the live twin refuses it (%s: %s, not_sent) and uploads nothing", async (caseId, reason, detail) => {
        const ctx = build()
        const { youtube, connection } = ctx
        await picked(ctx, YOUTUBE_PUBLISH_OPERATION, caseId)

        for (const title of ["a", "b"]) {
            const error = await failure(youtube.publish("ws-1", connection, video(title)))
            expect(providerRefusalReason(error)).toBe(reason)
            expect(providerRefusalDetail(error)).toBe(detail)
            expect(proofOf(error)).toBe("not_sent")
        }
        expect(providerRefusalReason(await failure(youtube.status(connection, VIDEO_1)))).toBe("not_found")
        await picked(ctx, YOUTUBE_PUBLISH_OPERATION, YOUTUBE_CASE.accepted)
        await expect(youtube.publish("ws-1", connection, video("c"))).resolves.toMatchObject({ videoId: "sbx-yt-video-000003" })
    })

    it("refuses an upload with a thumbnail not_available before anything is sent, whatever case is picked (the live adapter's own refusal)", async () => {
        const { youtube, connection } = build()

        const error = await failure(youtube.publish("ws-1", connection, video("x", { thumbnail: { fileId: "thumb-1" } })))

        expect(providerRefusalReason(error)).toBe("not_available")
        expect(providerRefusalDetail(error)).toBe("thumbnails.set: docs-missing")
        expect(proofOf(error)).toBe("not_sent")
    })

    it("YOUTUBE-11 (quotaExceeded), 12 (a 5xx), 13 (no answer), 20 (upload limit) throw the SAME failures as the live adapter (proof not_sent / unknown / unknown / not_sent)", async () => {
        const ctx = build()
        const { youtube, connection } = ctx
        const attempt = async (caseId: string) => {
            await picked(ctx, YOUTUBE_PUBLISH_OPERATION, caseId)
            return await failure(youtube.publish("ws-1", connection, video("x")))
        }

        const quota = await attempt(YOUTUBE_CASE.quotaExceeded)
        const outage = await attempt(YOUTUBE_CASE.serverError)
        const silent = await attempt(YOUTUBE_CASE.timeout)
        const limit = await attempt(YOUTUBE_CASE.uploadLimit)

        expect(quota).toMatchObject({ code: YoutubeErrorCode.RateLimited, params: { reason: "quotaExceeded" } })
        expect(outage).toMatchObject({ code: YoutubeErrorCode.Failed })
        expect(silent).toMatchObject({ code: YoutubeErrorCode.Unreachable })
        expect(providerRefusalReason(limit)).toBe("rejected")
        expect([quota, outage, silent, limit].map((one) => proofOf(one))).toEqual([
            liveProof(YoutubeErrorCode.RateLimited),
            liveProof(YoutubeErrorCode.Failed),
            liveProof(YoutubeErrorCode.Unreachable),
            liveProof(YoutubeErrorCode.Rejected),
        ])
        expect(providerRefusalReason(await failure(youtube.status(connection, VIDEO_1)))).toBe("not_found")
    })

    it("YOUTUBE-21 (grant revoked) and 22 (refresh cannot reach Google): the token store's failures proved not_sent, nothing sent; sticky until another case is picked", async () => {
        const ctx = build()
        const { youtube, connection } = ctx

        await picked(ctx, YOUTUBE_PUBLISH_OPERATION, YOUTUBE_CASE.grantRevoked)
        for (const title of ["a", "b"]) {
            const revoked = await failure(youtube.publish("ws-1", connection, video(title)))
            expect(revoked).toMatchObject({ code: "GOOGLE_CONNECTIONS_LOST" })
            expect(proofOf(revoked)).toBe("not_sent")
        }
        await picked(ctx, YOUTUBE_PUBLISH_OPERATION, YOUTUBE_CASE.refreshUnreachable)
        const unreachable = await failure(youtube.publish("ws-1", connection, video("c")))
        expect(unreachable).toMatchObject({ code: "GOOGLE_UNREACHABLE" })
        expect(proofOf(unreachable)).toBe("not_sent")
        await expect(failure(youtube.status(connection, VIDEO_1))).resolves.toMatchObject({ params: { detail: "video" } })
    })

    it("YOUTUBE-14: no answer, but the video WAS uploaded: a status read of the next running video id finds it", async () => {
        const ctx = build()
        const { youtube, connection } = ctx
        await picked(ctx, YOUTUBE_PUBLISH_OPERATION, YOUTUBE_CASE.appliedNoAnswer)

        const error = await failure(youtube.publish("ws-1", connection, video("x")))

        expect(error).toMatchObject({ code: YoutubeErrorCode.Unreachable })
        expect(proofOf(error)).toBe("unknown")
        await expect(youtube.status(connection, VIDEO_1)).resolves.toMatchObject({ state: "pending", uploadStatus: "uploaded" })
    })

    it("answers the status read's own outcomes: YOUTUBE-16 auth refused, 17 quota, 18 no answer, 9 not found; 15 goes back", async () => {
        const ctx = build()
        const { youtube, connection } = ctx
        await youtube.publish("ws-1", connection, video("x"))

        await picked(ctx, YOUTUBE_STATUS_OPERATION, YOUTUBE_CASE.statusAuthRefused)
        expect(providerRefusalReason(await failure(youtube.status(connection, VIDEO_1)))).toBe("auth_refused")
        await picked(ctx, YOUTUBE_STATUS_OPERATION, YOUTUBE_CASE.statusQuotaExceeded)
        expect(await failure(youtube.status(connection, VIDEO_1))).toMatchObject({ code: YoutubeErrorCode.RateLimited })
        await picked(ctx, YOUTUBE_STATUS_OPERATION, YOUTUBE_CASE.statusTimeout)
        expect(await failure(youtube.status(connection, VIDEO_1))).toMatchObject({ code: YoutubeErrorCode.Unreachable })
        await picked(ctx, YOUTUBE_STATUS_OPERATION, YOUTUBE_CASE.statusNotFound)
        expect(providerRefusalReason(await failure(youtube.status(connection, VIDEO_1)))).toBe("not_found")
        await picked(ctx, YOUTUBE_STATUS_OPERATION, YOUTUBE_CASE.statusRead)
        await expect(youtube.status(connection, VIDEO_1)).resolves.toMatchObject({ state: "pending" })
    })

    it("answers not_found (not_sent) for a video the account never uploaded (YOUTUBE-9 by its own default)", async () => {
        const { youtube, connection } = build()

        const error = await failure(youtube.status(connection, "nope"))

        expect(providerRefusalReason(error)).toBe("not_found")
        expect(proofOf(error)).toBe("not_sent")
    })

    it("takes one logged call per request under its own operation word, keyed by title or video id", async () => {
        const { youtube, connection, sandbox, account } = build()

        await youtube.publish("ws-1", connection, video("Video giới thiệu"))
        await youtube.status(connection, VIDEO_1)

        expect((await sandbox.calls(account)).map((call) => [call.operation, call.key])).toEqual([
            ["youtube.publish", "Video giới thiệu"],
            ["youtube.status", VIDEO_1],
        ])
        expect(await sandbox.calls(account, "publish")).toEqual([])
    })

    it("is deterministic: two fresh accounts walk the same ids and steps", async () => {
        const one = build()
        const two = build()

        expect(await one.youtube.publish("ws-1", one.connection, video("Video"))).toEqual(await two.youtube.publish("ws-1", two.connection, video("Video")))
        expect(await one.youtube.status(one.connection, VIDEO_1)).toEqual(await two.youtube.status(two.connection, VIDEO_1))
    })

    it("refuses a live account and a switched-off sandbox", async () => {
        const { youtube } = build()
        const live = await failure(youtube.status(connectionRecord({ provider: "google", id: "live-1" }), "x"))
        expect(live).toBeInstanceOf(ProviderSandboxError)
        expect((live as ProviderSandboxError).code).toBe(ProviderSandboxErrorCode.LiveAccount)

        const account = sandboxAccount({ provider: "google" })
        const off = new YoutubeSandboxVideoService(sandboxServiceOff(account).sandbox)
        const refused = await failure(off.status(connectionRecord({ provider: "google", id: account.id, sandbox: true }), "x"))
        expect((refused as ProviderSandboxError).code).toBe(ProviderSandboxErrorCode.Off)
    })

    it("has a catalogue of unique YOUTUBE-<n> ids on youtube.publish and youtube.status alone, ONE default tagged ok per operation, every case tagged, and no inbound case (a video is polled)", () => {
        const ids = YOUTUBE_SANDBOX_CATALOGUE.cases.map((one) => one.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.every((id) => /^YOUTUBE-\d+$/.test(id))).toBe(true)
        expect(YOUTUBE_SANDBOX_CATALOGUE.provider).toBe("google")
        expect(Object.values(YOUTUBE_CASE).toSorted()).toEqual([...ids].toSorted())
        expect(YOUTUBE_SANDBOX_CASES.every((one) => one.inbound === undefined && one.outcome !== undefined)).toBe(true)
        expect(new Set(YOUTUBE_SANDBOX_CASES.map((one) => one.operation))).toEqual(new Set([YOUTUBE_PUBLISH_OPERATION, YOUTUBE_STATUS_OPERATION]))
        for (const operation of [YOUTUBE_PUBLISH_OPERATION, YOUTUBE_STATUS_OPERATION]) {
            expect(YOUTUBE_SANDBOX_CASES.filter((one) => one.operation === operation && one.default === true).map((one) => one.outcome)).toEqual(["ok"])
        }
    })

    it("reaches no host: one constructor parameter and no integration or network word in its source", () => {
        expect(YoutubeSandboxVideoService.length).toBe(1)
        const source = readFileSync(__filename.replace(".spec.ts", ".ts"), "utf8")
        expect(source).not.toContain("@modules/integrations")
        expect(source).not.toContain("http")
    })
})
