import { FakeClock, mock } from "@starci/jest-preset"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import type { ConnectionApiTokenService } from "@modules/domain/connection-secrets"
import type { ConnectionsService } from "@modules/domain/connections"
import { DataSourcesError, DataSourcesErrorCode, type ImapClient } from "@modules/integrations/data-sources"
import { ImapInboxPollerService } from "./imap-inbox-poller.service"

const CONFIG = JSON.stringify({ folders: ["INBOX", "Support"], sinceDays: 7 })
const CREDENTIAL = JSON.stringify({ host: "imap.example.com", port: 993, secure: true, user: "shop@example.com", password: "p" })
const NOW = "2026-11-14T10:00:00.000Z"

const build = () => {
    const imap = mock<ImapClient>()
    imap.page.mockResolvedValue({ rows: [], fetched: 0, oldestAt: undefined, newestAt: undefined })
    const connections = mock<ConnectionsService>()
    connections.readSecret.mockResolvedValue({ plain: CREDENTIAL, webhookSecret: "" })
    const tokens = mock<ConnectionApiTokenService>()
    tokens.read.mockResolvedValue(CREDENTIAL)
    return { service: new ImapInboxPollerService(imap, new FakeClock(NOW), connections, tokens), imap, connections, tokens }
}

describe("ImapInboxPollerService: the mailbox's poll receiver (MAIL-IN rule MI-1; providers rule 12)", () => {
    it("reads a mailbox account's inbound half with its READ credential, in the chosen folders, never before the owner's look-back", async () => {
        const { service, imap, tokens, connections } = build()
        const window = { from: new Date("2026-10-01T00:00:00.000Z"), to: undefined, limit: 50 }

        await service.read(connectionRecord({ id: "smtp-1", provider: "smtp", meta: { config: CONFIG } }), window)

        expect(tokens.read).toHaveBeenCalledWith("smtp-1")
        expect(connections.readSecret).not.toHaveBeenCalled()
        expect(imap.page).toHaveBeenCalledWith(expect.objectContaining({ host: "imap.example.com" }), {
            folders: ["INBOX", "Support"],
            from: new Date("2026-11-07T10:00:00.000Z"),
            to: undefined,
            limit: 50,
        })
    })

    it("answers the page as imap.mail rows: the value the intake keeps (key folder:uidvalidity:uid) and when the mail was sent, newest first as read", async () => {
        const { service, imap } = build()
        const sent = new Date("2026-11-14T09:00:00.000Z")
        const older = new Date("2026-11-14T08:00:00.000Z")
        const mail = (uid: number, at: Date) => ({
            externalId: `INBOX:5:${uid}`,
            title: "Hoi gia",
            occurredAt: at,
            data: { folder: "INBOX", uid, from: [{ name: "Lan", address: "lan@example.com" }], subject: "Hoi gia", text: "Gia bao nhieu?", attachments: [], messageId: `<m${uid}@x.test>` },
        })
        imap.page.mockResolvedValue({ rows: [mail(8, sent), mail(7, older)], fetched: 2, oldestAt: older, newestAt: sent })

        const page = await service.read(connectionRecord({ id: "smtp-1", provider: "smtp", meta: { config: CONFIG } }), { from: new Date(NOW), to: undefined, limit: 50 })

        expect(page).toMatchObject({ kind: "page", fetched: 2, oldestAt: older, newestAt: sent })
        const items = page.kind === "page" ? page.items : []
        expect(items.map((item) => [Reflect.get(item.value, "externalId"), item.at])).toEqual([
            ["INBOX:5:8", sent],
            ["INBOX:5:7", older],
        ])
        expect(items[0]?.value).toMatchObject({ folder: "INBOX", uid: 8, subject: "Hoi gia", text: "Gia bao nhieu?", messageId: "<m8@x.test>" })
    })

    it("leaves a mail with no usable id out of the rows but still counts it as read", async () => {
        const { service, imap } = build()
        imap.page.mockResolvedValue({
            rows: [{ externalId: "", title: "x", occurredAt: new Date(NOW), data: { folder: "INBOX", uid: 1 } }],
            fetched: 1,
            oldestAt: new Date(NOW),
            newestAt: new Date(NOW),
        })

        const page = await service.read(connectionRecord({ id: "smtp-1", provider: "smtp", meta: { config: CONFIG } }), { from: new Date(NOW), to: undefined, limit: 50 })

        expect(page).toMatchObject({ kind: "page", items: [], fetched: 1 })
    })

    it("declares what the one poll job plans with: provider imap, type imap.mail, one login a second, dense cadence", () => {
        const { service } = build()

        expect(service.provider).toBe("imap")
        expect(service.dataType).toBe("imap.mail")
        expect(service.limits).toEqual({ ratePerSecond: 1, burst: 1, concurrency: 1 })
        expect(service.cadence).toEqual({ aloneMs: 300_000, besideWebhookMs: 300_000 })
    })

    it("reads an inbound half standing alone with its own credential", async () => {
        const { service, connections, tokens } = build()

        await service.read(connectionRecord({ id: "imap-1", provider: "imap", meta: { config: CONFIG } }), { from: new Date(NOW), to: undefined, limit: 50 })

        expect(connections.readSecret).toHaveBeenCalledWith("imap-1")
        expect(tokens.read).not.toHaveBeenCalled()
    })

    it("skips a sender with no inbound half, and a mailbox whose credential is gone", async () => {
        const { service, tokens, imap } = build()
        const window = { from: new Date(NOW), to: undefined, limit: 50 }

        await expect(service.read(connectionRecord({ id: "smtp-2", provider: "smtp", meta: {} }), window)).resolves.toEqual({ kind: "skipped", reason: "no_account" })
        tokens.read.mockResolvedValue(null)
        await expect(service.read(connectionRecord({ id: "smtp-1", provider: "smtp", meta: { config: CONFIG } }), window)).resolves.toEqual({ kind: "skipped", reason: "no_token" })
        expect(imap.page).not.toHaveBeenCalled()
    })

    it("classifies by the integration's typed code: a refused login is the credential, a server that does not answer is transient", () => {
        const { service } = build()

        expect(service.classify(new DataSourcesError({ code: DataSourcesErrorCode.Rejected }))).toEqual({ kind: "auth_failed", reason: "credential" })
        expect(service.classify(new DataSourcesError({ code: DataSourcesErrorCode.Unavailable }))).toEqual({ kind: "transient" })
        expect(service.classify(new Error("other"))).toEqual({ kind: "fatal" })
    })
})
