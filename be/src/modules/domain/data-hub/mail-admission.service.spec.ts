import { mock } from "@starci/jest-preset"
import type { EntityManager } from "typeorm"
import type { AccountDataIntakeService, AdmittedRow, PendingRow } from "@modules/domain/account-data"
import { imapMailInputsOf } from "@modules/domain/data-records"
import type { ProviderTriggersService } from "@modules/domain/provider-triggers"
import type { Logger } from "@modules/platform/logging"
import { IMAP_MAIL_TRIGGER } from "./imap-mail.trigger"
import { MailAdmissionService } from "./mail-admission.service"

const OWNER = { provider: "smtp", connectionId: "smtp-1", workspaceId: "ws-1" }
const MAIL = {
    externalId: "INBOX:1:7",
    title: "Hoi gia",
    occurredAt: new Date("2026-11-14T01:00:00.000Z"),
    data: { folder: "INBOX", uid: 7, from: [{ name: "Lan", address: "lan@example.com" }], subject: "Hoi gia", text: "Gia bao nhieu?", attachments: [], messageId: "<m7@x.test>" },
}

/** The `imap.mail` value of a mail as the poll receiver hands it, and the new row the intake answered for it. */
const admittedOf = (data: Record<string, unknown> = {}): AdmittedRow => {
    const [input] = imapMailInputsOf([{ ...MAIL, data: { ...MAIL.data, ...data } }])
    return { id: "row-7", type: "imap.mail", key: "INBOX:1:7", owner: OWNER, value: input?.value ?? {} }
}

const PENDING: PendingRow = { id: "row-7", type: "imap.mail", key: "INBOX:1:7", owner: OWNER, value: {} }
const tx = { marker: "tx" } as unknown as EntityManager

const build = (pending: PendingRow | null = PENDING, withTriggers = true) => {
    const intake = mock<AccountDataIntakeService>()
    intake.lockPending.mockResolvedValue(pending)
    const triggers = mock<ProviderTriggersService>()
    const logger = mock<Logger>()
    const service = new MailAdmissionService(logger, intake, withTriggers ? triggers : undefined)
    return { service, intake, triggers, logger }
}

describe("MailAdmissionService: a new mail row of the one poll job (MAIL-IN rule MI-4; account-data rules 2, 7, 10)", () => {
    it("wakes the mailbox's trigger in the SAME transaction with the stored row as its evidence, then completes the row", async () => {
        const { service, intake, triggers } = build()

        await service.admit(tx, admittedOf())

        expect(intake.lockPending).toHaveBeenCalledWith(tx, "imap.mail", "smtp-1", "INBOX:1:7")
        const [input, within] = triggers.deliver.mock.calls[0] ?? []
        expect(input).toMatchObject({
            workspaceId: "ws-1",
            declaration: IMAP_MAIL_TRIGGER,
            connectionId: "smtp-1",
            agentId: null,
            events: [{ event: { id: "INBOX:1:7", subject: { channel: "email", id: "lan@example.com", identity: "email" } }, raw: { type: "imap.mail", id: "row-7" } }],
        })
        expect(within).toBe(tx)
        expect(intake.complete).toHaveBeenCalledWith(tx, PENDING)
    })

    it("delivers before it completes: the wake and the row's completion commit together", async () => {
        const { service, intake, triggers } = build()

        await service.admit(tx, admittedOf())

        expect(triggers.deliver.mock.invocationCallOrder[0]).toBeLessThan(intake.complete.mock.invocationCallOrder[0] ?? 0)
    })

    it("hands the event the time the mail was sent", async () => {
        const { service, triggers } = build()

        await service.admit(tx, admittedOf())

        const [input] = triggers.deliver.mock.calls[0] ?? []
        expect(input?.events[0]?.occurredAt).toBe(MAIL.occurredAt.toISOString())
    })

    it("a mail no person wrote is counted and completed with no event", async () => {
        const { service, triggers, intake, logger } = build()

        await service.admit(tx, admittedOf({ autoSubmitted: "auto-replied" }))

        expect(triggers.deliver).not.toHaveBeenCalled()
        expect(intake.complete).toHaveBeenCalledWith(tx, PENDING)
        expect(logger.info).toHaveBeenCalledWith("data_hub.mail_not_from_person", { workspaceId: "ws-1", connectionId: "smtp-1", notFromPerson: 1 })
    })

    it("a row already completed (no pending row to lock) is nothing: no wake, no second completion", async () => {
        const { service, triggers, intake } = build(null)

        await service.admit(tx, admittedOf())

        expect(triggers.deliver).not.toHaveBeenCalled()
        expect(intake.complete).not.toHaveBeenCalled()
    })

    it("a stored value that is no mail is completed with no wake", async () => {
        const { service, triggers, intake } = build()

        await service.admit(tx, { ...admittedOf(), value: { nonsense: true } })

        expect(triggers.deliver).not.toHaveBeenCalled()
        expect(intake.complete).toHaveBeenCalledWith(tx, PENDING)
    })

    it("completes the row with no wake where no trigger service is wired", async () => {
        const { service, intake } = build(PENDING, false)

        await service.admit(tx, admittedOf())

        expect(intake.complete).toHaveBeenCalledWith(tx, PENDING)
    })

    it("leaves the row pending when the wake fails, so the failure rolls the transaction back", async () => {
        const { service, triggers, intake } = build()
        triggers.deliver.mockRejectedValue(new Error("matching down"))

        await expect(service.admit(tx, admittedOf())).rejects.toThrow("matching down")

        expect(intake.complete).not.toHaveBeenCalled()
    })
})
