import { FakeClock, mock } from "@starci/jest-preset"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { POLL_PAGE_SIZE, olderPageEnd } from "@modules/domain/connection-poll/connection-poll.policy"
import type { ConnectionApiTokenService } from "@modules/domain/connection-secrets"
import type { ConnectionsService } from "@modules/domain/connections"
import type { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import { DataSourcesError, DataSourcesErrorCode, type ImapClient } from "@modules/integrations/data-sources"
import { describeImapError } from "@modules/integrations/data-sources/imap-error.policy"
import { IMAP_MAIL_ROW_SCHEMA } from "./imap-mail.schema"
import { translateImapMailRow, type ImapMailRow } from "./imap-mail.trigger"
import { ImapInboxPollerService } from "./imap-inbox-poller.service"
import { ImapSandboxPollerService } from "./imap-sandbox-poller.service"
import { IMAP_SANDBOX_BUSY_SIZE, IMAP_SANDBOX_CASES } from "./imap-sandbox.catalogue"
import { imapLoginRefused, imapUnreachable } from "./imap-sandbox.failures"

const WINDOW = { from: new Date(0), to: undefined, limit: 50 }
const CONFIG = JSON.stringify({ folders: ["INBOX"], sinceDays: 30 })

/** The sandbox frame over a memory state: the account's next case is `picked`. */
const sandboxOf = (picked: () => string | null) => {
    const state = new Map<string, unknown>()
    const sandbox = mock<ProviderSandboxService>()
    sandbox.call.mockImplementation(async (account, _operation, _request, plan) =>
        await plan.answer({
            seq: 0,
            nextCase: picked(),
            read: (name: string, key: string) => Promise.resolve(state.get(`${account.id}:${name}:${key}`) ?? null),
            write: (name: string, key: string, value: unknown) => {
                state.set(`${account.id}:${name}:${key}`, value)
                return Promise.resolve()
            },
        } as Parameters<typeof plan.answer>[0]),
    )
    return sandbox
}

describe("ImapSandboxPollerService: the sandbox twin of a mailbox's poll face (IMAP-1 .. 16)", () => {
    it("answers ONE page of the picked set, newest first, once per account; on a mailbox account (smtp holding its inbound half) too", async () => {
        let picked: string | null = null
        const service = new ImapSandboxPollerService(sandboxOf(() => picked), new FakeClock("2026-11-14T10:00:00.000Z"))
        const mailbox = connectionRecord({ id: "smtp-1", provider: "smtp", sandbox: true, meta: { config: CONFIG } })

        const first = await service.read(mailbox, WINDOW)
        expect(first).toMatchObject({ kind: "page", fetched: 1 })
        expect(first.kind === "page" ? first.items.map((item) => Reflect.get(item.value, "externalId")) : []).toEqual(["INBOX:1:1"])
        expect(first.kind === "page" ? first.items.every((item) => item.at instanceof Date) : false).toBe(true)
        await expect(service.read(mailbox, WINDOW)).resolves.toMatchObject({ kind: "page", fetched: 0, items: [] })

        picked = "IMAP-9"
        const second = await service.read(mailbox, WINDOW)
        expect(second.kind === "page" ? second.items.map((item) => [Reflect.get(item.value, "externalId"), Reflect.get(item.value, "inReplyTo"), Reflect.get(item.value, "references")]) : []).toEqual([
            ["INBOX:1:2", "<sbx-smtp-000001@sandbox.nivo>", ["<sbx-smtp-000001@sandbox.nivo>"]],
        ])
    })

    it("hands IMAP-8's auto-reply with its Auto-Submitted header as the live reader would", async () => {
        const service = new ImapSandboxPollerService(sandboxOf(() => "IMAP-8"), new FakeClock("2026-11-14T10:00:00.000Z"))
        const page = await service.read(connectionRecord({ id: "imap-1", provider: "imap", sandbox: true, meta: {} }), WINDOW)

        expect(page.kind === "page" ? (page.items[0] === undefined ? undefined : Reflect.get(page.items[0].value, "autoSubmitted")) : null).toBe("auto-replied")
        expect(IMAP_SANDBOX_CASES.map((one) => one.id)).toEqual(Array.from({ length: 16 }, (_, index) => `IMAP-${String(index + 1)}`))
    })

    it("reads nothing for a sender with no inbound half", async () => {
        const sandbox = sandboxOf(() => null)
        const service = new ImapSandboxPollerService(sandbox, new FakeClock("2026-11-14T10:00:00.000Z"))

        await expect(service.read(connectionRecord({ id: "smtp-2", provider: "smtp", sandbox: true, meta: {} }), WINDOW)).resolves.toEqual({
            kind: "skipped",
            reason: "no_account",
        })
        expect(sandbox.call).not.toHaveBeenCalled()
    })
})

/** The pull of one picked set on a fresh account, as the translate reads each mail (the consuming door: the mailbox trigger). */
const lineOf = async (picked: string, window = WINDOW) => {
    const service = new ImapSandboxPollerService(sandboxOf(() => picked), new FakeClock("2026-11-14T10:00:00.000Z"))
    const page = await service.read(connectionRecord({ id: "smtp-9", provider: "smtp", sandbox: true, meta: { config: CONFIG } }), window)
    const items = page.kind === "page" ? page.items : []
    // The stored row the intake keeps must meet the trigger's own schema (the translate reads nothing else).
    return items.map((item) => translateImapMailRow(IMAP_MAIL_ROW_SCHEMA.parse(item.value) satisfies ImapMailRow))
}

describe("the mailbox sets IMAP-10 .. 13: what the live parser keeps, read by the mailbox trigger", () => {
    it("IMAP-10 / IMAP-11: a picture and a PDF are kept as name, type and size, and the line carries the file name (the bytes stay at the mailbox)", async () => {
        const service = new ImapSandboxPollerService(sandboxOf(() => "IMAP-10"), new FakeClock("2026-11-14T10:00:00.000Z"))
        const page = await service.read(connectionRecord({ id: "imap-1", provider: "imap", sandbox: true, meta: {} }), WINDOW)
        expect(page.kind === "page" ? page.items[0]?.value : null).toMatchObject({ attachments: [{ name: "loi-thanh-toan.jpg", type: "image/jpeg", size: 245_760 }] })

        const [picture] = await lineOf("IMAP-10")
        const [pdf] = await lineOf("IMAP-11")
        expect(picture?.data.attachments).toEqual(["loi-thanh-toan.jpg"])
        expect(pdf?.data.attachments).toEqual(["hoa-don-thang-10.pdf"])
        expect(pdf?.subject.id).toBe("binh.tran@example.com")
    })

    it("IMAP-13: a bounce (Return-Path <>) is no line, as an auto-reply (IMAP-8) is none: the trigger decides by the headers, never the words", async () => {
        expect(await lineOf("IMAP-13")).toEqual([null])
        expect(await lineOf("IMAP-8")).toEqual([null])
        expect((await lineOf("IMAP-1"))[0]).not.toBeNull()
    })

    it("IMAP-12: one unreadable message is kept as the live unreadable row (no sender, no text) and gives no line, while the readable mail of the page is brought", async () => {
        const lines = await lineOf("IMAP-12")

        expect(lines).toHaveLength(2)
        expect(lines.filter((line) => line !== null).map((line) => line.subject.id)).toEqual(["cuong.le@example.com"])
        expect(lines.filter((line) => line === null)).toHaveLength(1)
        const service = new ImapSandboxPollerService(sandboxOf(() => "IMAP-12"), new FakeClock("2026-11-14T10:00:00.000Z"))
        const page = await service.read(connectionRecord({ id: "smtp-9", provider: "smtp", sandbox: true, meta: { config: CONFIG } }), WINDOW)
        expect(page.kind === "page" ? page.items.map((item) => Reflect.get(item.value, "unreadable")) : []).toEqual([true, undefined])
    })
})

describe("IMAP-14 / IMAP-15 / IMAP-16: a refused login, a server that does not answer, a busy mailbox", () => {
    const mailbox = connectionRecord({ id: "smtp-9", provider: "smtp", sandbox: true, meta: { config: CONFIG } })
    const liveOf = () => new ImapInboxPollerService(mock<ImapClient>(), new FakeClock("2026-11-14T10:00:00.000Z"), mock<ConnectionsService>(), mock<ConnectionApiTokenService>())

    it("IMAP-14 throws the live reader's refused login and the poll classifies it as the live poller does: the credential, only the owner fixes it", async () => {
        const service = new ImapSandboxPollerService(sandboxOf(() => "IMAP-14"), new FakeClock("2026-11-14T10:00:00.000Z"))
        const failure: unknown = await service.read(mailbox, WINDOW).catch((cause: unknown) => cause)

        expect(failure).toBeInstanceOf(DataSourcesError)
        expect(failure).toMatchObject({ code: DataSourcesErrorCode.Rejected, params: { detail: describeImapError({ authenticationFailed: true, message: "x" }).detail } })
        expect(service.classify(failure)).toEqual({ kind: "auth_failed", reason: "credential" })
        // The live poller reads the same failure the same way (one reading, never two).
        expect(liveOf().classify(failure)).toEqual(service.classify(failure))
        expect(imapLoginRefused()).toBeInstanceOf(DataSourcesError)
    })

    it("IMAP-15 throws the live reader's refused connection and the poll tries again (transient), as the live poller does", async () => {
        const service = new ImapSandboxPollerService(sandboxOf(() => "IMAP-15"), new FakeClock("2026-11-14T10:00:00.000Z"))
        const failure: unknown = await service.read(mailbox, WINDOW).catch((cause: unknown) => cause)

        expect(failure).toMatchObject({ code: DataSourcesErrorCode.Unavailable })
        expect(service.classify(failure)).toEqual({ kind: "transient" })
        expect(liveOf().classify(failure)).toEqual({ kind: "transient" })
        expect(imapUnreachable().params.detail).toBe(describeImapError({ code: "ECONNREFUSED", message: "x" }).detail)
        // Whatever the frame itself throws (a live account, the switch off) is never retried.
        expect(service.classify(new Error("frame"))).toEqual({ kind: "fatal" })
    })

    it("IMAP-16: 230 mails are more than one poll page: the first page is the newest 200 and is full, the walk reads the older 30 and stops", async () => {
        expect(IMAP_SANDBOX_BUSY_SIZE).toBeGreaterThan(POLL_PAGE_SIZE)
        const service = new ImapSandboxPollerService(sandboxOf(() => "IMAP-16"), new FakeClock("2026-11-14T10:00:00.000Z"))
        const window = { from: new Date(0), to: undefined, limit: POLL_PAGE_SIZE }

        const first = await service.read(mailbox, window)
        if (first.kind !== "page") throw new Error("a page was expected")
        expect(first.items).toHaveLength(POLL_PAGE_SIZE)
        expect(first.fetched).toBe(IMAP_SANDBOX_BUSY_SIZE)
        // The walk's own rule asks for an older page because this one is full.
        const end = olderPageEnd(first, POLL_PAGE_SIZE, undefined)
        expect(end).toEqual(first.oldestAt)

        const second = await service.read(mailbox, { ...window, to: end })
        if (second.kind !== "page") throw new Error("a page was expected")
        // The page edge is read again (the live client includes it too; the intake keeps it once by its key), then the 30 older ones; not full: the walk stops.
        expect(second.items).toHaveLength(IMAP_SANDBOX_BUSY_SIZE - POLL_PAGE_SIZE + 1)
        expect(olderPageEnd(second, POLL_PAGE_SIZE, end)).toBeUndefined()
        const keys = new Set([...first.items, ...second.items].map((item) => Reflect.get(item.value, "externalId")))
        expect(keys.size).toBe(IMAP_SANDBOX_BUSY_SIZE)
    })
})
