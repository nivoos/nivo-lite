import { readFileSync } from "node:fs"
import type { InstagramMediaRequest } from "@modules/domain/provider-registry"
import { proofOf, providerRefusalDetail, providerRefusalReason } from "@modules/domain/provider-registry"
import { ProviderSandboxError, ProviderSandboxErrorCode } from "@modules/domain/provider-sandbox"
import { MetaPublishingError, MetaPublishingErrorCode } from "@modules/integrations/meta-publishing"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxAccount, sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import { MetaInstagramSandboxPublishService } from "./meta-instagram-sandbox-publish.service"
import {
    INSTAGRAM_CASE,
    INSTAGRAM_PUBLISH_OPERATION,
    INSTAGRAM_RELEASE_OPERATION,
    INSTAGRAM_SANDBOX_CASES,
    INSTAGRAM_SANDBOX_CATALOGUE,
    INSTAGRAM_STATUS_OPERATION,
} from "./meta-instagram-sandbox.catalogue"
import { metaPublishingFailureOf } from "./meta-publishing-failure.policy"

const build = () => {
    const account = sandboxAccount({ provider: "meta" })
    const { sandbox } = sandboxServiceOf(account)
    const connection = connectionRecord({ provider: "meta", id: account.id, workspaceId: account.workspaceId, sandbox: true })
    return { account, sandbox, connection, instagram: new MetaInstagramSandboxPublishService(sandbox) }
}

const failure = (work: Promise<unknown>): Promise<unknown> => Promise.resolve(work.then(() => undefined, (cause: unknown) => cause))
const image = (caption: string | null, overrides: Partial<InstagramMediaRequest> = {}): InstagramMediaRequest => ({
    mediaType: "image",
    caption,
    mediaUrl: "https://shop.test/a.jpg",
    children: [],
    altText: null,
    aiGenerated: null,
    ...overrides,
})
const CONTAINER_1 = "sbx-ig-container-000001"
const picked = (ctx: ReturnType<typeof build>, operation: string, caseId: string) => ctx.sandbox.setNextCase(ctx.account, operation, caseId)

describe("MetaInstagramSandboxPublishService", () => {
    it("INSTAGRAM-1 (default): publishes a finished container at once", async () => {
        const { instagram, connection } = build()

        await expect(instagram.publish(connection, image("Bộ sưu tập thu"))).resolves.toEqual({
            containerId: CONTAINER_1,
            state: "published",
            statusCode: "PUBLISHED",
            mediaId: "sbx-ig-media-000001",
        })
        await expect(instagram.status(connection, CONTAINER_1)).resolves.toEqual({ containerId: CONTAINER_1, state: "published", statusCode: "PUBLISHED", mediaId: null })
    })

    it("picks nothing from the request's own words: the old magic captions are ordinary media now", async () => {
        const { instagram, connection } = build()

        for (const caption of ["Reel hậu trường buổi chụp", "Reel lỗi mã hóa", "Caption vi phạm chính sách", "Video quá dài"]) {
            await expect(instagram.publish(connection, image(caption, { mediaType: "reels" }))).resolves.toMatchObject({ state: "published" })
        }
    })

    it("INSTAGRAM-2: answers a processing container, then finished by the status poll, then published by release", async () => {
        const ctx = build()
        const { instagram, connection } = ctx
        await picked(ctx, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_CASE.processing)

        await expect(instagram.publish(connection, image("x", { mediaType: "reels" }))).resolves.toMatchObject({ state: "pending", statusCode: "IN_PROGRESS", mediaId: null })
        await expect(instagram.status(connection, CONTAINER_1)).resolves.toMatchObject({ state: "ready", statusCode: "FINISHED" })
        await expect(instagram.release(connection, CONTAINER_1)).resolves.toEqual({ containerId: CONTAINER_1, state: "published", statusCode: "PUBLISHED", mediaId: "sbx-ig-media-000001" })
    })

    it.each([
        [INSTAGRAM_CASE.encodingError, "ERROR"],
        [INSTAGRAM_CASE.expired, "EXPIRED"],
    ] as const)("%s: the container ends %s, never publishable, on the later status read, and stays there (a failed job)", async (caseId, code) => {
        const ctx = build()
        const { instagram, connection } = ctx
        await picked(ctx, INSTAGRAM_PUBLISH_OPERATION, caseId)

        await expect(instagram.publish(connection, image("x", { mediaType: "reels" }))).resolves.toMatchObject({ state: "pending" })
        await expect(instagram.status(connection, CONTAINER_1)).resolves.toMatchObject({ state: "failed", statusCode: code })
        await expect(instagram.release(connection, CONTAINER_1)).resolves.toMatchObject({ state: "failed", statusCode: code, mediaId: null })
    })

    it("INSTAGRAM-8: the container is accepted and its status reads IN_PROGRESS on every read, for ever (a job that never finishes)", async () => {
        const ctx = build()
        const { instagram, connection } = ctx
        await picked(ctx, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_CASE.neverFinishes)

        await instagram.publish(connection, image("x", { mediaType: "reels" }))
        for (let read = 0; read < 5; read += 1) {
            await expect(instagram.status(connection, CONTAINER_1)).resolves.toMatchObject({ state: "pending", statusCode: "IN_PROGRESS" })
        }
        await expect(instagram.release(connection, CONTAINER_1)).resolves.toMatchObject({ state: "pending", mediaId: null })
    })

    it.each([
        [INSTAGRAM_CASE.policy, "rejected", "policy: media violates community guidelines"],
        [INSTAGRAM_CASE.tooLong, "rejected", "video duration over the limit"],
        [INSTAGRAM_CASE.authRefused, "auth_refused", "Error validating access token: session expired"],
    ] as const)("%s (sticky) refuses as the live twin refuses it (%s, not_sent) and creates nothing", async (caseId, reason, detail) => {
        const ctx = build()
        const { instagram, connection, sandbox, account } = ctx
        await picked(ctx, INSTAGRAM_PUBLISH_OPERATION, caseId)

        const error = await failure(instagram.publish(connection, image("x")))

        expect(providerRefusalReason(error)).toBe(reason)
        expect(providerRefusalDetail(error)).toBe(detail)
        expect(proofOf(error)).toBe("not_sent")
        expect((await sandbox.calls(account, INSTAGRAM_PUBLISH_OPERATION))[0]?.result.outcome).toBe("threw")
        expect(providerRefusalReason(await failure(instagram.status(connection, CONTAINER_1)))).toBe("not_found")
    })

    it("INSTAGRAM-12, 13, 14: a rate limit, an outage and no answer throw the SAME failures as the live adapter (rate limited not_sent; unavailable and unreachable unknown); nothing is created", async () => {
        const ctx = build()
        const { instagram, connection } = ctx
        const live = (code: MetaPublishingErrorCode) => metaPublishingFailureOf(new MetaPublishingError({ code, params: {} }))

        await picked(ctx, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_CASE.rateLimited)
        const limited = await failure(instagram.publish(connection, image("x")))
        await picked(ctx, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_CASE.serverError)
        const outage = await failure(instagram.publish(connection, image("x")))
        await picked(ctx, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_CASE.timeout)
        const silent = await failure(instagram.publish(connection, image("x")))

        expect([limited, outage, silent]).toEqual([
            expect.objectContaining({ code: MetaPublishingErrorCode.RateLimited }),
            expect.objectContaining({ code: MetaPublishingErrorCode.Failed }),
            expect.objectContaining({ code: MetaPublishingErrorCode.Unreachable }),
        ])
        expect([limited, outage, silent].map((one) => proofOf(one))).toEqual([
            proofOf(live(MetaPublishingErrorCode.RateLimited)),
            proofOf(live(MetaPublishingErrorCode.Failed)),
            proofOf(live(MetaPublishingErrorCode.Unreachable)),
        ])
        expect(providerRefusalReason(await failure(instagram.status(connection, CONTAINER_1)))).toBe("not_found")
    })

    it("INSTAGRAM-15: no answer, but the container WAS created: a status read finds it finished and release publishes it", async () => {
        const ctx = build()
        const { instagram, connection } = ctx
        await picked(ctx, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_CASE.appliedNoAnswer)

        const error = await failure(instagram.publish(connection, image("x")))

        expect(error).toMatchObject({ code: MetaPublishingErrorCode.Unreachable })
        expect(proofOf(error)).toBe("unknown")
        await expect(instagram.status(connection, CONTAINER_1)).resolves.toMatchObject({ state: "ready", statusCode: "FINISHED" })
        await expect(instagram.release(connection, CONTAINER_1)).resolves.toMatchObject({ state: "published" })
    })

    it("INSTAGRAM-16: a carousel creates its first item's container, then the second item is refused rejected: partly done, nothing published", async () => {
        const ctx = build()
        const { instagram, connection, sandbox, account } = ctx
        await picked(ctx, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_CASE.carouselPartial)
        const items = [1, 2, 3].map(() => ({ kind: "image" as const, url: "https://shop.test/a.jpg" }))

        const error = await failure(instagram.publish(connection, image("x", { mediaType: "carousel", mediaUrl: null, children: items })))

        expect(providerRefusalReason(error)).toBe("rejected")
        expect(providerRefusalDetail(error)).toBe("carousel item")
        expect(proofOf(error)).toBe("not_sent")
        expect(await sandbox.kept(account, "container", `${CONTAINER_1}-1`)).toMatchObject({ published: false })
        // a request that is no carousel is answered like the default
        await expect(instagram.publish(connection, image("y"))).resolves.toMatchObject({ state: "published" })
    })

    it("answers the status read's own outcomes: INSTAGRAM-18 auth refused, 19 rate limit, 20 no answer, 9 not found (sticky until the default is picked)", async () => {
        const ctx = build()
        const { instagram, connection } = ctx
        await instagram.publish(connection, image("x"))

        await picked(ctx, INSTAGRAM_STATUS_OPERATION, INSTAGRAM_CASE.statusAuthRefused)
        expect(providerRefusalReason(await failure(instagram.status(connection, CONTAINER_1)))).toBe("auth_refused")
        await picked(ctx, INSTAGRAM_STATUS_OPERATION, INSTAGRAM_CASE.statusRateLimited)
        expect(await failure(instagram.status(connection, CONTAINER_1))).toMatchObject({ code: MetaPublishingErrorCode.RateLimited })
        await picked(ctx, INSTAGRAM_STATUS_OPERATION, INSTAGRAM_CASE.statusTimeout)
        expect(await failure(instagram.status(connection, CONTAINER_1))).toMatchObject({ code: MetaPublishingErrorCode.Unreachable })
        await picked(ctx, INSTAGRAM_STATUS_OPERATION, INSTAGRAM_CASE.statusNotFound)
        expect(providerRefusalReason(await failure(instagram.status(connection, CONTAINER_1)))).toBe("not_found")
        await picked(ctx, INSTAGRAM_STATUS_OPERATION, INSTAGRAM_CASE.statusRead)
        await expect(instagram.status(connection, CONTAINER_1)).resolves.toMatchObject({ state: "published" })
    })

    it("answers the release's own outcomes: INSTAGRAM-21 auth refused, 22 rate limit, 23 no answer (nothing published), 7 not found", async () => {
        const ctx = build()
        const { instagram, connection } = ctx
        await picked(ctx, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_CASE.processing)
        await instagram.publish(connection, image("x", { mediaType: "reels" }))
        await instagram.status(connection, CONTAINER_1)

        await picked(ctx, INSTAGRAM_RELEASE_OPERATION, INSTAGRAM_CASE.releaseAuthRefused)
        expect(providerRefusalReason(await failure(instagram.release(connection, CONTAINER_1)))).toBe("auth_refused")
        await picked(ctx, INSTAGRAM_RELEASE_OPERATION, INSTAGRAM_CASE.releaseRateLimited)
        expect(await failure(instagram.release(connection, CONTAINER_1))).toMatchObject({ code: MetaPublishingErrorCode.RateLimited })
        await picked(ctx, INSTAGRAM_RELEASE_OPERATION, INSTAGRAM_CASE.releaseTimeout)
        expect(await failure(instagram.release(connection, CONTAINER_1))).toMatchObject({ code: MetaPublishingErrorCode.Unreachable })
        await expect(instagram.status(connection, CONTAINER_1)).resolves.toMatchObject({ state: "ready" })
        await picked(ctx, INSTAGRAM_RELEASE_OPERATION, INSTAGRAM_CASE.releaseNotFound)
        expect(providerRefusalReason(await failure(instagram.release(connection, CONTAINER_1)))).toBe("not_found")
    })

    it("INSTAGRAM-24: the release's answer is lost but the container WAS published: the next status read says published (the confirm read)", async () => {
        const ctx = build()
        const { instagram, connection } = ctx
        await picked(ctx, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_CASE.processing)
        await instagram.publish(connection, image("x", { mediaType: "reels" }))
        await instagram.status(connection, CONTAINER_1)
        await picked(ctx, INSTAGRAM_RELEASE_OPERATION, INSTAGRAM_CASE.releaseAppliedNoAnswer)

        const error = await failure(instagram.release(connection, CONTAINER_1))

        expect(error).toMatchObject({ code: MetaPublishingErrorCode.Unreachable })
        expect(proofOf(error)).toBe("unknown")
        await expect(instagram.status(connection, CONTAINER_1)).resolves.toMatchObject({ state: "published", statusCode: "PUBLISHED" })
    })

    it("refuses a request that does not fit its kind before anything is created, as the live twin does", async () => {
        const { instagram, connection } = build()

        expect(providerRefusalDetail(await failure(instagram.publish(connection, image("x", { mediaUrl: null }))))).toBe("media url")
        expect(providerRefusalDetail(await failure(instagram.publish(connection, image("x", { mediaType: "carousel", mediaUrl: null }))))).toBe("carousel items")
        const items = Array.from({ length: 21 }, () => ({ kind: "image" as const, url: "https://shop.test/a.jpg" }))
        expect(providerRefusalDetail(await failure(instagram.publish(connection, image("x", { mediaType: "carousel", mediaUrl: null, children: items }))))).toBe("carousel items")
        await expect(instagram.publish(connection, image("x", { mediaType: "carousel", mediaUrl: null, children: items.slice(0, 2) }))).resolves.toMatchObject({ state: "published" })
    })

    it("answers not_found (not_sent) for a container the account never created (INSTAGRAM-7, 9 by their own default)", async () => {
        const { instagram, connection } = build()

        for (const call of [instagram.status(connection, "nope"), instagram.release(connection, "nope")]) {
            const error = await failure(call)
            expect(providerRefusalReason(error)).toBe("not_found")
            expect(proofOf(error)).toBe("not_sent")
        }
    })

    it("takes one logged call per request under its own operation word, keyed by caption or container id", async () => {
        const ctx = build()
        const { instagram, connection, sandbox, account } = ctx
        await picked(ctx, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_CASE.processing)

        await instagram.publish(connection, image("Reel hậu trường buổi chụp", { mediaType: "reels" }))
        await instagram.status(connection, CONTAINER_1)
        await instagram.release(connection, CONTAINER_1)

        expect((await sandbox.calls(account)).map((call) => [call.operation, call.key])).toEqual([
            ["instagram.publish", "Reel hậu trường buổi chụp"],
            ["instagram.status", CONTAINER_1],
            ["instagram.release", CONTAINER_1],
        ])
    })

    it("is deterministic: two fresh accounts walk the same ids and words", async () => {
        const one = build()
        const two = build()
        const reel = image("Reel hậu trường buổi chụp", { mediaType: "reels" })
        await picked(one, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_CASE.processing)
        await picked(two, INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_CASE.processing)

        expect(await one.instagram.publish(one.connection, reel)).toEqual(await two.instagram.publish(two.connection, reel))
        expect(await one.instagram.status(one.connection, CONTAINER_1)).toEqual(await two.instagram.status(two.connection, CONTAINER_1))
    })

    it("refuses a live account and a switched-off sandbox", async () => {
        const { instagram } = build()
        const live = await failure(instagram.status(connectionRecord({ provider: "meta", id: "live-1" }), "x"))
        expect(live).toBeInstanceOf(ProviderSandboxError)
        expect((live as ProviderSandboxError).code).toBe(ProviderSandboxErrorCode.LiveAccount)

        const account = sandboxAccount({ provider: "meta" })
        const off = new MetaInstagramSandboxPublishService(sandboxServiceOff(account).sandbox)
        const refused = await failure(off.status(connectionRecord({ provider: "meta", id: account.id, sandbox: true }), "x"))
        expect((refused as ProviderSandboxError).code).toBe(ProviderSandboxErrorCode.Off)
    })

    it("has a catalogue of unique INSTAGRAM-<n> ids on three operations, ONE default tagged ok per operation, every case tagged, and no inbound case (a container is polled)", () => {
        const ids = INSTAGRAM_SANDBOX_CATALOGUE.cases.map((one) => one.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.every((id) => /^INSTAGRAM-\d+$/.test(id))).toBe(true)
        expect(Object.values(INSTAGRAM_CASE).toSorted()).toEqual([...ids].toSorted())
        expect(INSTAGRAM_SANDBOX_CASES.every((one) => one.inbound === undefined && one.outcome !== undefined)).toBe(true)
        for (const operation of [INSTAGRAM_PUBLISH_OPERATION, INSTAGRAM_STATUS_OPERATION, INSTAGRAM_RELEASE_OPERATION]) {
            expect(INSTAGRAM_SANDBOX_CASES.filter((one) => one.operation === operation && one.default === true).map((one) => one.outcome)).toEqual(["ok"])
        }
    })

    it("reaches no host: one constructor parameter and no integration or network word in its source", () => {
        expect(MetaInstagramSandboxPublishService.length).toBe(1)
        const source = readFileSync(__filename.replace(".spec.ts", ".ts"), "utf8")
        expect(source).not.toContain("@modules/integrations")
        expect(source).not.toContain("http")
    })
})
