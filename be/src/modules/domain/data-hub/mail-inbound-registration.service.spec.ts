import { mock } from "@starci/jest-preset"
import type { EntityManager } from "typeorm"
import { AccountDataAdmissionsService, type AdmittedRow } from "@modules/domain/account-data"
import { IMAP_MAIL_TYPE } from "@modules/domain/data-records"
import { PollReceiverRegistryService } from "@modules/domain/provider-registry"
import { SandboxCatalogueRegistryService } from "@modules/domain/provider-sandbox"
import type { ImapInboxPollerService } from "./imap-inbox-poller.service"
import type { ImapSandboxPollerService } from "./imap-sandbox-poller.service"
import { IMAP_SANDBOX_CATALOGUE, MAILBOX_INBOUND_SANDBOX_CATALOGUE } from "./imap-sandbox.catalogue"
import type { MailAdmissionService } from "./mail-admission.service"
import { MailInboundRegistrationService } from "./mail-inbound-registration.service"

const receiverOf = (dataType: string) => ({
    provider: "imap",
    dataType,
    limits: { ratePerSecond: 1, burst: 1, concurrency: 1 },
    cadence: { aloneMs: 300_000, besideWebhookMs: 300_000 },
    read: jest.fn(),
    classify: jest.fn(),
})

const build = () => {
    const receivers = new PollReceiverRegistryService()
    const admissions = new AccountDataAdmissionsService()
    const catalogues = mock<SandboxCatalogueRegistryService>()
    const live = receiverOf(IMAP_MAIL_TYPE) as unknown as ImapInboxPollerService
    const sandbox = receiverOf(IMAP_MAIL_TYPE) as unknown as ImapSandboxPollerService
    const mail = mock<MailAdmissionService>()
    const service = new MailInboundRegistrationService(receivers, admissions, catalogues, live, sandbox, mail)
    return { service, receivers, admissions, catalogues, live, sandbox, mail }
}

describe("MailInboundRegistrationService: a mailbox's inbound half joins the one poll job (owner R95; providers rule 12)", () => {
    it("registers ONE receiver of provider imap with its live face and its sandbox twin", () => {
        const { service, receivers, live, sandbox } = build()

        service.onModuleInit()

        expect(receivers.providers()).toEqual(["imap"])
        expect(receivers.portFor({ provider: "imap", sandbox: false })).toBe(live)
        expect(receivers.portFor({ provider: "imap", sandbox: true })).toBe(sandbox)
        expect(receivers.liveOf("imap")?.dataType).toBe("imap.mail")
    })

    it("registers the admission of imap.mail: a new row goes to the mail admission with the transaction and the row", async () => {
        const { service, admissions, mail } = build()
        service.onModuleInit()
        const tx = { marker: "tx" } as unknown as EntityManager
        const row: AdmittedRow = { id: "r-1", type: "imap.mail", key: "INBOX:1:7", owner: { provider: "smtp", connectionId: "smtp-1", workspaceId: "ws-1" }, value: {} }

        expect(admissions.has("imap.mail")).toBe(true)
        await admissions.admit(tx, row)

        expect(mail.admit).toHaveBeenCalledWith(tx, row)
    })

    it("hands the sandbox page the inbound cases under both account kinds: imap and the mailbox smtp account", () => {
        const { service, catalogues } = build()

        service.onModuleInit()

        expect(catalogues.register).toHaveBeenCalledTimes(2)
        expect(catalogues.register).toHaveBeenCalledWith(IMAP_SANDBOX_CATALOGUE)
        expect(catalogues.register).toHaveBeenCalledWith(MAILBOX_INBOUND_SANDBOX_CATALOGUE)
        expect([IMAP_SANDBOX_CATALOGUE.provider, MAILBOX_INBOUND_SANDBOX_CATALOGUE.provider]).toEqual(["imap", "smtp"])
        expect(MAILBOX_INBOUND_SANDBOX_CATALOGUE.cases).toBe(IMAP_SANDBOX_CATALOGUE.cases)
    })
})
