import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { ConnectionApiTokenService } from "@modules/domain/connection-secrets"
import { ConnectionsService, type ConnectionRecord } from "@modules/domain/connections"
import { IMAP, type ImapClient } from "@modules/integrations/data-sources"
import { DataHubErrorCode } from "./errors/data-hub.error"
import type { ImapInput } from "./imap-connection.contracts"
import { ImapWizardService } from "./imap-wizard.service"
import { IMAP_CONNECTION_TEXT } from "./messages/imap-connection.messages"

const actor = { principalId: "owner-1", workspaceId: "ws-1" }
const CONFIG = JSON.stringify({ folders: ["INBOX"], sinceDays: 30 })
const CREDENTIAL = JSON.stringify({ host: "imap.example.com", port: 993, secure: true, user: "shop@example.com", password: "saved" })

const input = (overrides: Partial<ImapInput> = {}): ImapInput => ({
    name: "Shop mailbox",
    email: "Shop@Example.com",
    host: "imap.example.com",
    port: 993,
    security: "tls",
    user: "shop@example.com",
    password: "typed",
    folders: ["INBOX"],
    sinceDays: 30,
    ...overrides,
})

const smtpOf = (overrides: Partial<ConnectionRecord> = {}): ConnectionRecord =>
    connectionRecord({ id: "smtp-1", workspaceId: "ws-1", provider: "smtp", meta: { from_email: "shop@example.com", host: "smtp.example.com" }, ...overrides })
const imapOf = (overrides: Partial<ConnectionRecord> = {}): ConnectionRecord =>
    connectionRecord({ id: "imap-1", workspaceId: "ws-1", provider: "imap", meta: { email: "shop@example.com", config: CONFIG }, ...overrides })

const build = async () => {
    const connections = mock<ConnectionsService>()
    connections.authorize.mockResolvedValue({ role: "owner", displayName: "Lan" })
    connections.listByProvider.mockResolvedValue([])
    connections.create.mockResolvedValue("imap-new")
    connections.agentIds.mockResolvedValue(["agent-1", "agent-1"])
    const tokens = mock<ConnectionApiTokenService>()
    tokens.write.mockResolvedValue(true)
    tokens.read.mockResolvedValue(null)
    const imap = mock<ImapClient>()
    imap.listFolders.mockResolvedValue(["INBOX"])
    const moduleRef = await Test.createTestingModule({
        providers: [
            ImapWizardService,
            { provide: ConnectionsService, useValue: connections },
            { provide: ConnectionApiTokenService, useValue: tokens },
            { provide: IMAP, useValue: imap },
        ],
    }).compile()
    return { service: moduleRef.get(ImapWizardService), connections, tokens, imap }
}

describe("ImapWizardService.save: one mailbox = one account (MAIL-IN rules MI-1, MI-2)", () => {
    it("writes the inbound half onto the workspace's mailbox (smtp) account of the SAME address: read credential + settings, no second account", async () => {
        const { service, connections, tokens } = await build()
        connections.listByProvider.mockImplementation((_ws, provider) => Promise.resolve(provider === "smtp" ? [smtpOf()] : []))

        await expect(service.save(actor, input())).resolves.toBe("smtp-1")

        expect(connections.create).not.toHaveBeenCalled()
        const [connectionId, credential] = tokens.write.mock.calls[0] ?? []
        expect(connectionId).toBe("smtp-1")
        expect(JSON.parse(credential ?? "{}")).toMatchObject({ host: "imap.example.com", password: "typed" })
        expect(connections.patch).toHaveBeenCalledWith("ws-1", "smtp-1", {
            meta: expect.objectContaining({ from_email: "shop@example.com", host: "smtp.example.com", config: CONFIG, email: "Shop@Example.com" }),
            lastError: null,
        })
        expect(connections.writeSecret).not.toHaveBeenCalled()
    })

    it("updates the address's inbound half standing alone (an imap account) instead of making a second one", async () => {
        const { service, connections } = await build()
        connections.listByProvider.mockImplementation((_ws, provider) => Promise.resolve(provider === "imap" ? [imapOf()] : []))

        await expect(service.save(actor, input())).resolves.toBe("imap-1")

        expect(connections.create).not.toHaveBeenCalled()
        expect(connections.writeSecret).toHaveBeenCalledWith("imap-1", expect.stringContaining("typed"))
    })

    it("makes a new inbound half standing alone (an imap account) only for an address that has no account", async () => {
        const { service, connections } = await build()

        await expect(service.save(actor, input())).resolves.toBe("imap-new")

        expect(connections.create).toHaveBeenCalledWith(
            expect.objectContaining({ provider: "imap", status: "connected", meta: expect.objectContaining({ config: CONFIG }) }),
        )
    })

    it("refuses an inbound half whose address is not the mailbox account's own (a mailbox is one address)", async () => {
        const { service, connections } = await build()
        connections.find.mockResolvedValue(smtpOf())

        await expect(service.save(actor, input({ connectionId: "smtp-1", email: "other@example.com" }))).rejects.toMatchObject({
            code: DataHubErrorCode.Invalid,
            params: { detail: IMAP_CONNECTION_TEXT.addressOther },
        })
    })

    it("refuses an account that is no mailbox, and a missing one", async () => {
        const { service, connections } = await build()
        connections.find.mockResolvedValue(connectionRecord({ id: "z-1", workspaceId: "ws-1", provider: "zalo_oa" }))
        await expect(service.save(actor, input({ connectionId: "z-1" }))).rejects.toMatchObject({ params: { detail: IMAP_CONNECTION_TEXT.notMailbox } })
        connections.find.mockResolvedValue(null)
        await expect(service.save(actor, input({ connectionId: "gone" }))).rejects.toMatchObject({ code: DataHubErrorCode.NotFound })
    })
})

describe("ImapWizardService.load / test", () => {
    it("loads the inbound half of a mailbox account from its READ credential, never the password", async () => {
        const { service, connections, tokens } = await build()
        connections.find.mockResolvedValue(smtpOf({ meta: { from_email: "shop@example.com", config: CONFIG } }))
        tokens.read.mockResolvedValue(CREDENTIAL)

        const view = await service.load(actor, "smtp-1")

        expect(view).toMatchObject({ id: "smtp-1", provider: "smtp", email: "shop@example.com", host: "imap.example.com", folders: ["INBOX"], agentIds: ["agent-1"] })
        expect(JSON.stringify(view)).not.toContain("saved")
    })

    it("has nothing to load for a sender with no inbound half", async () => {
        const { service, connections } = await build()
        connections.find.mockResolvedValue(smtpOf())

        await expect(service.load(actor, "smtp-1")).rejects.toMatchObject({ code: DataHubErrorCode.NotFound })
    })

    it("tests with the saved password of the named mailbox when none is typed", async () => {
        const { service, connections, imap } = await build()
        connections.find.mockResolvedValue(imapOf())
        connections.readSecret.mockResolvedValue({ plain: CREDENTIAL, webhookSecret: "" })

        await expect(service.test(actor, input({ connectionId: "imap-1", password: "" }))).resolves.toEqual(["INBOX"])

        expect(imap.listFolders).toHaveBeenCalledWith(expect.objectContaining({ password: "saved" }))
    })
})
