import { ChannelsError, ChannelsErrorCode } from "@modules/domain/channels"
import { mailDeliveryOf, mailThreadOf } from "./mail-delivery.policy"
import type { SendEmailResult } from "./email-messages.contracts"

// Rule SO-1: the mail channel maps its OWN typed answers (the workspace mailer's status, the integration's error code) onto the customer
// send port's classes, as every channel does (QB-SEND): delivered, a refusal, an unknown outcome, or the thrown "nothing was sent, try later".

const result = (over: Partial<SendEmailResult>): SendEmailResult => ({ status: "failed", emailMessageId: "e-1", via: "workspace", ...over })

const notSent = (sent: SendEmailResult): unknown => {
    try {
        mailDeliveryOf(sent)
        return null
    } catch (cause) {
        return cause
    }
}

describe("mailDeliveryOf: the mail channel's answers on the one send's classes", () => {
    it("sent = delivered", () => {
        expect(mailDeliveryOf(result({ status: "sent" }))).toEqual({ delivered: true, failure: null, outcome: "acknowledged" })
    })

    it("a timeout or an unknown server answer = outcome unknown (the send is repeatable: same key next time)", () => {
        expect(mailDeliveryOf(result({ code: "MAIL_TIMEOUT" }))).toEqual({ delivered: false, failure: "mail_timeout", outcome: "ambiguous" })
        expect(mailDeliveryOf(result({ code: "MAIL_UNKNOWN" }))).toMatchObject({ outcome: "ambiguous" })
        expect(mailDeliveryOf(result({}))).toMatchObject({ outcome: "ambiguous" })
    })

    it("a limit or a server that could not be reached = the thrown not-sent class (park and retry)", () => {
        for (const sent of [result({ status: "rate_limited" }), result({ code: "MAIL_LIMIT" }), result({ code: "MAIL_CONNECT" }), result({ code: "MAIL_TLS" })]) {
            const thrown = notSent(sent)
            expect(thrown).toBeInstanceOf(ChannelsError)
            expect(thrown).toMatchObject({ code: ChannelsErrorCode.SendUnavailable })
        }
        expect(notSent(result({ code: "MAIL_CONNECT" }))).toMatchObject({ params: { reason: "mail_connect" } })
    })

    it("a refused recipient, login or sender, no mail account, a blocked address = a refusal with the provider's own word", () => {
        expect(mailDeliveryOf(result({ code: "MAIL_RECIPIENT" }))).toEqual({ delivered: false, failure: "mail_recipient", outcome: "rejected" })
        expect(mailDeliveryOf(result({ code: "MAIL_AUTH" }))).toMatchObject({ failure: "mail_auth", outcome: "rejected" })
        expect(mailDeliveryOf(result({ status: "no_smtp" }))).toMatchObject({ failure: "mail_not_connected", outcome: "rejected" })
        expect(mailDeliveryOf(result({ status: "blocked", failure: "recipient" }))).toMatchObject({ failure: "mail_recipient", outcome: "rejected" })
    })
})

describe("mailThreadOf: the thread a reply answers (RFC 5322 3.6.4; MAIL-IN rule MI-5)", () => {
    it("In-Reply-To = the newest of the person's mails, References = all of them oldest first; a key that is no Message-ID is left out", () => {
        expect(mailThreadOf(["email:<a@x.test>", "email:INBOX:1:2", "email:<b@x.test>"])).toEqual({
            inReplyTo: "<b@x.test>",
            references: ["<a@x.test>", "<b@x.test>"],
        })
        expect(mailThreadOf(["zalo:123"])).toBeNull()
        expect(mailThreadOf([])).toBeNull()
    })
})
