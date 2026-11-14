import { mock } from "@starci/jest-preset"
import type { ChannelTarget } from "@modules/domain/channels"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { MailCustomerSendService } from "./mail-customer-send.service"
import { WorkspaceMailService } from "./workspace-mail.service"

// Rule SO-1: the customer channel `email` of the one send. The port only frames the words as a mail and sends it on THE account the send
// resolved, through the workspace mail service (the mail log, the account's data, the SMTP registry's live | sandbox switch).

const ACCOUNT = connectionRecord({ id: "smtp-1", workspaceId: "ws-1", provider: "smtp" })
const TARGET: ChannelTarget = { id: "route-9", workspaceId: "ws-1", channel: "email", externalId: "lan@example.vn", connectionId: "smtp-1" }
const REQUEST = {
    workspaceId: "ws-1",
    conversationId: "route-9",
    messageId: "call:run-1:answer:abc",
    text: "Da em gui anh bao gia.",
    subject: "Bao gia gia han",
    at: new Date("2026-11-14T10:00:00.000Z"),
}

describe("MailCustomerSendService: the mail channel of the one customer send", () => {
    it("mails the words with the subject on the resolved account, as a customer message, and answers delivered", async () => {
        const mail = mock<WorkspaceMailService>()
        mail.send.mockResolvedValue({ status: "sent", emailMessageId: "e-1", via: "workspace", messageId: "sbx-smtp-000001" })
        const port = new MailCustomerSendService(mail)

        await expect(port.send(ACCOUNT, TARGET, "lan@example.vn", REQUEST)).resolves.toEqual({
            delivered: true,
            failure: null,
            outcome: "acknowledged",
        })
        expect(port.provider).toBe("smtp")
        expect(mail.send).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: "ws-1",
                connectionId: "smtp-1",
                to: "lan@example.vn",
                subject: "Bao gia gia han",
                purpose: "customer_message",
                audience: "customer",
                refs: { route_id: "route-9", send_key: "call:run-1:answer:abc" },
            }),
        )
        const [[sent]] = mail.send.mock.calls
        expect(sent?.text).toContain("Da em gui anh bao gia.")
    })

    it("a timeout of the account's server is an unknown outcome, not a refusal", async () => {
        const mail = mock<WorkspaceMailService>()
        mail.send.mockResolvedValue({ status: "failed", emailMessageId: "e-2", via: "workspace", code: "MAIL_TIMEOUT" })
        await expect(new MailCustomerSendService(mail).send(ACCOUNT, TARGET, "lan@example.vn", REQUEST)).resolves.toMatchObject({
            delivered: false,
            outcome: "ambiguous",
        })
    })

    it("MAIL-IN rule MI-5: a reply carries the thread of the person's mails it answers (In-Reply-To the newest, References all)", async () => {
        const mail = mock<WorkspaceMailService>()
        mail.send.mockResolvedValue({ status: "sent", emailMessageId: "e-3", via: "workspace", messageId: "sbx-smtp-000002" })

        await new MailCustomerSendService(mail).send(ACCOUNT, TARGET, "lan@example.vn", {
            ...REQUEST,
            answers: ["email:<m1@x.test>", "email:INBOX:1:5", "email:<m2@x.test>"],
        })
        await new MailCustomerSendService(mail).send(ACCOUNT, TARGET, "lan@example.vn", REQUEST)

        expect(mail.send.mock.calls[0]?.[0].thread).toEqual({ inReplyTo: "<m2@x.test>", references: ["<m1@x.test>", "<m2@x.test>"] })
        expect(mail.send.mock.calls[1]?.[0].thread).toBeUndefined()
    })

    it("MAIL-IN rule MI-3: a mail account is an entrance only when it holds its inbound half too", () => {
        const port = new MailCustomerSendService(mock<WorkspaceMailService>())

        expect(port.entranceOf(connectionRecord({ id: "smtp-1", provider: "smtp", meta: { config: "{}" } }))).toBeNull()
        expect(port.entranceOf(connectionRecord({ id: "smtp-2", provider: "smtp", meta: { from_email: "shop@x.test" } }))).toBe("inbound")
    })
})
