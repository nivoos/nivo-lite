import { readFileSync } from "node:fs"
import { MetaPublishingError, MetaPublishingErrorCode } from "@modules/integrations/meta-publishing"
import { proofOf, providerRefusalDetail, providerRefusalReason } from "@modules/domain/provider-registry"
import { ProviderSandboxError, ProviderSandboxErrorCode } from "@modules/domain/provider-sandbox"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import { MetaFacebookSandboxPublishService } from "./meta-facebook-sandbox-publish.service"
import { FACEBOOK_CASE, FACEBOOK_PUBLISH_OPERATION, FACEBOOK_SANDBOX_CASES, FACEBOOK_SANDBOX_CATALOGUE } from "./meta-facebook-sandbox.catalogue"
import { metaPublishingFailureOf } from "./meta-publishing-failure.policy"

const build = () => {
    const account = sandboxAccount({ provider: "meta" })
    const { sandbox } = sandboxServiceOf(account)
    const connection = connectionRecord({ provider: "meta", id: account.id, workspaceId: account.workspaceId, sandbox: true })
    return { account, sandbox, connection, facebook: new MetaFacebookSandboxPublishService(sandbox) }
}

const failure = (work: Promise<unknown>): Promise<unknown> => Promise.resolve(work.then(() => undefined, (cause: unknown) => cause))
const text = (message: string | null, link: string | null = null) => ({ message, link, media: null })

/** What the live adapter throws for a client failure of that code (the live mapping of `meta-facebook-publish.service.ts`). */
const liveFailure = (code: MetaPublishingErrorCode, params: Record<string, string | number> = {}): unknown =>
    metaPublishingFailureOf(new MetaPublishingError({ code, params }))

describe("MetaFacebookSandboxPublishService", () => {
    it("FACEBOOK-1 (default): accepts a text post, a link post, a photo and a video the way the live Page edges answer", async () => {
        const { facebook, connection } = build()

        await expect(facebook.publish(connection, text("Ra mắt sản phẩm mới"))).resolves.toEqual({ kind: "text", postId: "100000000000001_000001", mediaId: null })
        await expect(facebook.publish(connection, text(null, "https://shop.test/a"))).resolves.toMatchObject({ kind: "link", postId: "100000000000001_000002" })
        await expect(
            facebook.publish(connection, { message: "Ảnh", link: null, media: { kind: "photo", url: "https://shop.test/a.jpg", title: null } }),
        ).resolves.toEqual({ kind: "photo", postId: "100000000000001_000003", mediaId: "sbx-photo-000003" })
        await expect(
            facebook.publish(connection, { message: "Clip", link: null, media: { kind: "video", url: "https://shop.test/a.mp4", title: "T" } }),
        ).resolves.toEqual({ kind: "video", postId: null, mediaId: "sbx-video-000004" })
    })

    it("picks nothing from the request's own words: the old magic messages are ordinary posts now", async () => {
        const { facebook, connection } = build()

        for (const message of ["Mua ngay giá sốc, số lượng có hạn", "Video quay toàn bộ buổi lễ", "Bài đăng khi token hết hạn"]) {
            await expect(facebook.publish(connection, text(message))).resolves.toMatchObject({ kind: "text" })
        }
    })

    it.each([
        [FACEBOOK_CASE.policy, "rejected", "policy: spam content"],
        [FACEBOOK_CASE.tooLarge, "rejected", "video file too large"],
        [FACEBOOK_CASE.authRefused, "auth_refused", "Error validating access token: session expired"],
    ] as const)("%s (sticky) refuses as the live twin refuses it (%s, not_sent), creates nothing and stays until the default is picked again", async (picked, reason, detail) => {
        const { facebook, connection, sandbox, account } = build()
        await sandbox.setNextCase(account, FACEBOOK_PUBLISH_OPERATION, picked)

        for (const attempt of [1, 2]) {
            const error = await failure(facebook.publish(connection, text(`Post ${String(attempt)}`)))
            expect(providerRefusalReason(error)).toBe(reason)
            expect(providerRefusalDetail(error)).toBe(detail)
            expect(proofOf(error)).toBe("not_sent")
        }
        expect((await sandbox.calls(account, FACEBOOK_PUBLISH_OPERATION)).map((one) => one.result.outcome)).toEqual(["threw", "threw"])
        await sandbox.setNextCase(account, FACEBOOK_PUBLISH_OPERATION, FACEBOOK_CASE.accepted)
        await expect(facebook.publish(connection, text("Again"))).resolves.toMatchObject({ kind: "text" })
    })

    it("FACEBOOK-7 (rate limit): throws the SAME failure the live adapter throws for Graph's code 4 (a rate-limited MetaPublishingError, proof not_sent)", async () => {
        const { facebook, connection, sandbox, account } = build()
        await sandbox.setNextCase(account, FACEBOOK_PUBLISH_OPERATION, FACEBOOK_CASE.rateLimited)

        const error = await failure(facebook.publish(connection, text("Hi")))
        const live = liveFailure(MetaPublishingErrorCode.RateLimited, { status: 429, code: 4, detail: "" })

        expect(error).toBeInstanceOf(MetaPublishingError)
        expect(error).toMatchObject({ code: MetaPublishingErrorCode.RateLimited })
        expect(proofOf(error)).toBe("not_sent")
        expect(proofOf(error)).toBe(proofOf(live))
        expect((await sandbox.kept(account, "post", "100000000000001_000001"))).toBeNull()
    })

    it("FACEBOOK-8 (outage, a 5xx) and FACEBOOK-9 (no answer): the live failures with proof unknown, nothing posted", async () => {
        const { facebook, connection, sandbox, account } = build()

        await sandbox.setNextCase(account, FACEBOOK_PUBLISH_OPERATION, FACEBOOK_CASE.serverError)
        const outage = await failure(facebook.publish(connection, text("Hi")))
        await sandbox.setNextCase(account, FACEBOOK_PUBLISH_OPERATION, FACEBOOK_CASE.timeout)
        const silent = await failure(facebook.publish(connection, text("Hi")))

        expect(outage).toMatchObject({ code: MetaPublishingErrorCode.Failed })
        expect(silent).toMatchObject({ code: MetaPublishingErrorCode.Unreachable })
        expect([proofOf(outage), proofOf(silent)]).toEqual(["unknown", "unknown"])
        expect([proofOf(outage), proofOf(silent)]).toEqual([proofOf(liveFailure(MetaPublishingErrorCode.Failed)), proofOf(liveFailure(MetaPublishingErrorCode.Unreachable))])
        expect(await sandbox.kept(account, "post", "100000000000001_000001")).toBeNull()
    })

    it("FACEBOOK-10: no answer as FACEBOOK-9, but the post WAS made: it is in the account's kept posts and a second publish posts again", async () => {
        const { facebook, connection, sandbox, account } = build()
        await sandbox.setNextCase(account, FACEBOOK_PUBLISH_OPERATION, FACEBOOK_CASE.appliedNoAnswer)

        const error = await failure(facebook.publish(connection, text("Hi")))

        expect(error).toMatchObject({ code: MetaPublishingErrorCode.Unreachable })
        expect(proofOf(error)).toBe("unknown")
        expect(await sandbox.kept(account, "post", "100000000000001_000001")).toMatchObject({ kind: "text", message: "Hi" })
        await sandbox.setNextCase(account, FACEBOOK_PUBLISH_OPERATION, FACEBOOK_CASE.accepted)
        await expect(facebook.publish(connection, text("Hi"))).resolves.toMatchObject({ postId: "100000000000001_000002" })
    })

    it("refuses an empty post rejected before anything is sent, as the live twin does, whatever case is picked", async () => {
        const { facebook, connection, sandbox, account } = build()
        await sandbox.setNextCase(account, FACEBOOK_PUBLISH_OPERATION, FACEBOOK_CASE.timeout)

        const error = await failure(facebook.publish(connection, { message: null, link: null, media: null }))

        expect(providerRefusalReason(error)).toBe("rejected")
        expect(providerRefusalDetail(error)).toBe("message, link or media")
        expect(proofOf(error)).toBe("not_sent")
    })

    it("logs exactly one call per request under facebook.publish with its key and request, and does it again on a second call (no idempotency)", async () => {
        const { facebook, connection, sandbox, account } = build()
        const request = text("Hello")

        const first = await facebook.publish(connection, request)
        const second = await facebook.publish(connection, request)

        expect(first).not.toEqual(second)
        const calls = await sandbox.calls(account, FACEBOOK_PUBLISH_OPERATION)
        expect(calls).toHaveLength(2)
        expect(calls[0]).toMatchObject({ key: "Hello", request, result: { outcome: "answered", value: first } })
        expect(await sandbox.calls(account, "publish")).toEqual([])
    })

    it("is deterministic: two fresh accounts answer the same", async () => {
        const one = build()
        const two = build()

        await expect(one.facebook.publish(one.connection, text("Hi"))).resolves.toEqual(await two.facebook.publish(two.connection, text("Hi")))
    })

    it("refuses a live account and a switched-off sandbox", async () => {
        const { facebook } = build()
        const live = await failure(facebook.publish(connectionRecord({ provider: "meta", id: "live-1" }), text("Hi")))
        expect(live).toBeInstanceOf(ProviderSandboxError)
        expect((live as ProviderSandboxError).code).toBe(ProviderSandboxErrorCode.LiveAccount)

        const account = sandboxAccount({ provider: "meta" })
        const off = new MetaFacebookSandboxPublishService(sandboxServiceOff(account).sandbox)
        const refused = await failure(off.publish(connectionRecord({ provider: "meta", id: account.id, sandbox: true }), text("Hi")))
        expect((refused as ProviderSandboxError).code).toBe(ProviderSandboxErrorCode.Off)
    })

    it("has a catalogue of unique FACEBOOK-<n> ids for facebook.publish alone, one default tagged ok, every case tagged, and no inbound case (a post is synchronous)", () => {
        const ids = FACEBOOK_SANDBOX_CATALOGUE.cases.map((one) => one.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.every((id) => /^FACEBOOK-\d+$/.test(id))).toBe(true)
        expect(FACEBOOK_SANDBOX_CATALOGUE.provider).toBe("meta")
        expect(Object.values(FACEBOOK_CASE).toSorted()).toEqual([...ids].toSorted())
        expect(FACEBOOK_SANDBOX_CASES.every((one) => one.inbound === undefined && one.operation === FACEBOOK_PUBLISH_OPERATION && one.outcome !== undefined)).toBe(true)
        expect(FACEBOOK_SANDBOX_CASES.filter((one) => one.default === true).map((one) => [one.id, one.outcome])).toEqual([["FACEBOOK-1", "ok"]])
    })

    it("reaches no host: one constructor parameter and no integration or network word in its source", () => {
        expect(MetaFacebookSandboxPublishService.length).toBe(1)
        const source = readFileSync(__filename.replace(".spec.ts", ".ts"), "utf8")
        expect(source).not.toContain("@modules/integrations")
        expect(source).not.toContain("http")
    })
})
