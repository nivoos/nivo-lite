import { FakeClock, mock } from "@starci/jest-preset"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import type { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import { ImapSandboxPollerService } from "./imap-sandbox-poller.service"
import { IMAP_SANDBOX_CASES } from "./imap-sandbox.catalogue"

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

describe("ImapSandboxPollerService: the sandbox twin of a mailbox's poll face (IMAP-1 .. 9)", () => {
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
        expect(IMAP_SANDBOX_CASES.map((one) => one.id)).toEqual(["IMAP-1", "IMAP-2", "IMAP-3", "IMAP-4", "IMAP-5", "IMAP-6", "IMAP-7", "IMAP-8", "IMAP-9"])
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
