import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { StorageAssetsPort, StorageObjectsPort } from "@modules/integrations/object-storage"
import { REMOTE_FILES } from "@modules/integrations/remote-files"
import type { RemoteFileRequest, RemoteFiles } from "@modules/integrations/remote-files"
import { EFFECTS } from "@modules/platform/effects"
import { ERROR_REPORTER, type ErrorReporter } from "@modules/platform/errors"
import { LOGGER } from "@modules/platform/logging"
import { ok } from "@modules/platform/primitives"
import type { Logger } from "@modules/platform/logging"
import { keptEffectsLedger } from "@tests/fixtures/builders/inbound-chain.builder"
import { CHAT_FILES_ASSETS, CHAT_FILES_STORAGE } from "./chat-files.decorators"
import { ChatFilesLogEvent } from "./chat-files.log-events"
import { CustomerFilesService } from "./customer-files.service"

// D-MX-4 (live IMG, 2026-11-11): Zalo's `user_send_image` stored only "[image] <caption>" with `files` null, so no step saw
// the picture. The picture is now read once from the channel's address and kept in the shop's own store; the line keeps the shop's
// address, which never expires.

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const ZALO_URL = "https://photo-zalo.test/abc.jpg"

/** The delivery job the files are kept under. */
const JOB = { jobId: "job-1" }

/** What the network says when nothing answers: the classifier calls it transient. */
const down = (): Error => Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" })

const build = async (withAssets = true) => {
    const logger = mock<Logger>()
    const remote = mock<RemoteFiles>()
    const storage = mock<StorageObjectsPort>()
    const assets = mock<StorageAssetsPort>()
    const errors = mock<ErrorReporter>()
    assets.upload.mockResolvedValue({ error: null })
    const ledger = keptEffectsLedger()
    const moduleRef = await Test.createTestingModule({
        providers: [
            CustomerFilesService,
            { provide: LOGGER, useValue: logger },
            { provide: REMOTE_FILES, useValue: remote },
            { provide: CHAT_FILES_STORAGE, useValue: storage },
            { provide: EFFECTS, useValue: ledger.effects },
            ...(withAssets ? [{ provide: CHAT_FILES_ASSETS, useValue: assets }] : []),
            { provide: ERROR_REPORTER, useValue: errors },
        ],
    }).compile()
    return { service: moduleRef.get(CustomerFilesService), logger, remote, storage, assets, errors, ledger }
}

const answering = (bytes: Buffer | null, contentType = "image/jpeg", status = 200) =>
    (request: RemoteFileRequest) =>
        Promise.resolve({
            status,
            contentType,
            location: undefined,
            length: bytes?.length ?? 0,
            bytes: bytes !== null && request.accepts(contentType) ? bytes : null,
        })

describe("CustomerFilesService.keep", () => {
    it("LIVE IMG: reads the picture once from Zalo, keeps it under a path the message decides, the line gets the shop's address", async () => {
        const { service, remote, assets } = await build()
        remote.read.mockImplementation(answering(JPEG))

        const [kept] = await service.keep(JOB, "ws-1", "zalo:m-1", [{ kind: "image", url: ZALO_URL, name: "" }])

        expect(remote.read).toHaveBeenCalledWith(expect.objectContaining({ url: ZALO_URL, maxBytes: 10 * 1024 * 1024 }))
        const path = String(assets.upload.mock.calls[0]?.[1])
        expect(path).toMatch(/^ws-1\/chat\/customer\/[0-9a-f]{32}-0\.jpg$/u)
        expect(assets.upload).toHaveBeenCalledWith("media", path, JPEG, "image/jpeg")
        expect(kept).toEqual({ id: path, url: `chat-file:${path}`, name: path.slice(path.lastIndexOf("/") + 1), contentType: "image/jpeg" })
        expect(kept?.url).not.toContain("zalo")
    })

    it("writes the same object when the same message is heard again (a redelivery or a retried job)", async () => {
        const { service, remote, assets } = await build()
        remote.read.mockImplementation(answering(JPEG))

        await service.keep(JOB, "ws-1", "zalo:m-1", [{ kind: "image", url: ZALO_URL, name: "" }])
        await service.keep({ jobId: "job-2" }, "ws-1", "zalo:m-1", [{ kind: "image", url: ZALO_URL, name: "" }])

        expect(assets.upload.mock.calls[0]?.[1]).toBe(assets.upload.mock.calls[1]?.[1])
    })

    // DEF-7 (MX N-01): a picture-only line was stored `{ url: "", name: "", contentType: "image/*" }` and only a warning said why: the
    // line did not say the file was not kept nor why, and nobody was told. Now the reason is on the line and each file is reported.
    it("keeps a file it could not read on the line with no address and WHY in its id, and reports each as an app error", async () => {
        const { service, remote, logger, errors } = await build()
        remote.read
            .mockImplementationOnce(answering(null, "image/jpeg", 404))
            .mockImplementationOnce(answering(Buffer.from("<html>"), "text/html"))
            .mockRejectedValueOnce(Object.assign(new Error("address refused"), { code: "ERR_INVALID_URL" }))

        const kept = await service.keep(JOB, "ws-1", "zalo:m-2", [
            { kind: "image", url: ZALO_URL, name: "" },
            { kind: "image", url: ZALO_URL, name: "" },
            { kind: "file", url: ZALO_URL, name: "a.pdf" },
        ])

        expect(kept.map((file) => [file.id, file.url, file.contentType])).toEqual([
            ["unread:refused_404:0", "", "image/*"],
            ["unread:refused_200:1", "", "image/*"],
            ["unread:fetch_failed:2", "", "application/octet-stream"],
        ])
        expect(logger.warn).toHaveBeenCalledWith(ChatFilesLogEvent.CustomerFileNotKept, expect.any(Object))
        expect(errors.report.mock.calls.map(([scope, , context]) => [scope, context])).toEqual([
            ["chat_files.customer_file_not_kept", { workspaceId: "ws-1", event: "zalo:m-2", index: 0, reason: "refused_404" }],
            ["chat_files.customer_file_not_kept", { workspaceId: "ws-1", event: "zalo:m-2", index: 1, reason: "refused_200" }],
            ["chat_files.customer_file_not_kept", { workspaceId: "ws-1", event: "zalo:m-2", index: 2, reason: "fetch_failed" }],
        ])
    })

    it("keeps nothing when the app has no whole-file store, and reads nothing", async () => {
        const { service, remote, errors } = await build(false)

        const kept = await service.keep(JOB, "ws-1", "zalo:m-3", [{ kind: "image", url: ZALO_URL, name: "" }])

        expect(kept.map((file) => [file.id, file.url])).toEqual([["unread:no_store:0", ""]])
        expect(remote.read).not.toHaveBeenCalled()
        expect(errors.report).toHaveBeenCalledTimes(1)
    })
})

describe("CustomerFilesService.keep: the customer's file host failing never fails the delivery; the shop's own store down does", () => {
    it("records a read that failed on the way (the network) as a typed, reported not-kept entry (R72 DEF-7), and the delivery goes on", async () => {
        const { service, remote, assets, errors, ledger } = await build()
        remote.read.mockRejectedValue(down())

        const [kept] = await service.keep(JOB, "ws-1", "zalo:m-4", [{ kind: "image", url: ZALO_URL, name: "" }])

        expect(kept).toMatchObject({ id: "unread:fetch_failed:0", url: "", notKept: "fetch_failed" })
        expect(assets.upload).not.toHaveBeenCalled()
        expect(errors.report).toHaveBeenCalledWith(
            "chat_files.customer_file_not_kept",
            expect.anything(),
            { workspaceId: "ws-1", event: "zalo:m-4", index: 0, reason: "fetch_failed" },
        )
        expect(ledger.rows.get("job-1:file:0")).toMatchObject({ acts: 1, settled: true })
    })

    it("records a channel that answers a server failure (5xx or 429) or a refusal (404) as a typed not-kept entry", async () => {
        const busy = await build()
        busy.remote.read.mockImplementation(answering(null, "text/html", 503))
        const [busyKept] = await busy.service.keep(JOB, "ws-1", "zalo:m-5", [{ kind: "image", url: ZALO_URL, name: "" }])
        expect(busyKept?.id).toBe("unread:refused_503:0")

        const gone = await build()
        gone.remote.read.mockImplementation(answering(null, "image/jpeg", 404))
        const [kept] = await gone.service.keep(JOB, "ws-1", "zalo:m-5", [{ kind: "image", url: ZALO_URL, name: "" }])
        expect(kept?.id).toBe("unread:refused_404:0")
    })

    it("THROWS a store that is down, but records a store that refused the copy for good as not kept", async () => {
        const outage = await build()
        outage.remote.read.mockImplementation(answering(JPEG))
        outage.assets.upload.mockResolvedValue({ error: down() })
        await expect(outage.service.keep(JOB, "ws-1", "zalo:m-6", [{ kind: "image", url: ZALO_URL, name: "" }])).rejects.toMatchObject({ code: "REMOTE_FILES_UNAVAILABLE" })

        const refusing = await build()
        refusing.remote.read.mockImplementation(answering(JPEG))
        refusing.assets.upload.mockResolvedValue({ error: new Error("bucket policy") })
        const [kept] = await refusing.service.keep(JOB, "ws-1", "zalo:m-6", [{ kind: "image", url: ZALO_URL, name: "" }])
        expect(kept?.id).toBe("unread:store_failed:0")
    })

    it("a retried or resumed delivery gets the entry kept the first time without reading the channel again (its address expires)", async () => {
        const { service, remote, assets, ledger } = await build()
        remote.read.mockImplementation(answering(JPEG))

        const first = await service.keep(JOB, "ws-1", "zalo:m-7", [{ kind: "image", url: ZALO_URL, name: "" }])
        const again = await service.keep(JOB, "ws-1", "zalo:m-7", [{ kind: "image", url: ZALO_URL, name: "" }])

        expect(again).toEqual(first)
        expect(remote.read).toHaveBeenCalledTimes(1)
        expect(assets.upload).toHaveBeenCalledTimes(1)
        expect(ledger.rows.get("job-1:file:0")?.acts).toBe(1)
    })

    it("keeps the typed not-kept entry on the ledger too, so a resume does not read a refused address again", async () => {
        const { service, remote, ledger } = await build()
        remote.read.mockImplementation(answering(null, "image/jpeg", 404))

        const first = await service.keep(JOB, "ws-1", "zalo:m-8", [{ kind: "image", url: ZALO_URL, name: "" }])
        const again = await service.keep(JOB, "ws-1", "zalo:m-8", [{ kind: "image", url: ZALO_URL, name: "" }])

        expect(again).toEqual(first)
        expect(again[0]?.notKept).toBe("refused_404")
        expect(remote.read).toHaveBeenCalledTimes(1)
        expect(ledger.rows.get("job-1:file:0")?.acts).toBe(1)
    })
})

describe("CustomerFilesService.bytesOf", () => {
    it("reads a kept file of the workspace, and never one of another workspace or an address that is not the shop's", async () => {
        const { service, storage } = await build()
        storage.download.mockResolvedValue(ok({ bytes: JPEG, contentType: "image/jpeg" }))

        await expect(service.bytesOf("ws-1", "chat-file:ws-1/chat/customer/k-0.jpg")).resolves.toEqual({
            contentType: "image/jpeg",
            bytes: JPEG,
        })
        await expect(service.bytesOf("ws-1", "chat-file:ws-2/chat/customer/k-0.jpg")).resolves.toBeNull()
        await expect(service.bytesOf("ws-1", ZALO_URL)).resolves.toBeNull()
        expect(storage.download).toHaveBeenCalledTimes(1)
    })
})
