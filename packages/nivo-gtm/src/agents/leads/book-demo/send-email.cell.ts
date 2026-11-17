import { z } from "zod"
import type { MailSend, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"

export const SendEmailInput = z.strictObject({ to: z.string().min(3).max(200), name: z.string().max(120), label: z.string().min(1).max(40), link: z.string().max(500) })
/** Nothing to report: a mail that did not go out throws its declared refusal. */
export const SendEmailOutput = z.strictObject({})
/** The mailbox the confirmation goes out from: the id of a mail account of the workspace (empty: the engine refuses `mailbox_needs_pick` and nothing is sent). */
export const SendEmailSettings = z.strictObject({ mailboxId: z.string().max(80).default(""), subject: z.string().min(1).max(200).default("Xác nhận lịch demo NIVO") })

type In = z.infer<typeof SendEmailInput>
type Out = z.infer<typeof SendEmailOutput>
type Settings = z.infer<typeof SendEmailSettings>

/**
 * Emails the demo confirmation: one act, `mail.send` through the workspace's mailbox. It leaves the company, so the engine runs the step in `ask` mode and the workspace cannot switch it to `auto`.
 * The mailbox comes from the setting `mailboxId`; without one the engine refuses `mailbox_needs_pick`, the cell hands it up and the step lets the run go on.
 */
export class SendEmail implements Node<typeof SendEmailInput, typeof SendEmailOutput, typeof SendEmailSettings> {
    readonly key = keyOf("leads-send-email")
    readonly version = 2
    readonly title = { vi: "Gửi email xác nhận demo", en: "Email the demo confirmation" }
    readonly input = SendEmailInput
    readonly output = SendEmailOutput
    readonly settings = SendEmailSettings
    readonly reads = []
    readonly mutation = "mail.send"

    run(input: In, reach: NodeReach<Settings>): Out {
        const hello = input.name === "" ? "Chào bạn" : `Chào ${input.name}`
        const where = input.link === "" ? "Chúng tôi sẽ gửi link tham gia trước giờ hẹn." : `Link tham gia: ${input.link}`
        const text = `${hello},\n\nNIVO xác nhận lịch demo của bạn: ${input.label} (giờ Việt Nam).\n${where}\n\nHẹn gặp bạn!\nNIVO`
        const { mailboxId, subject } = reach.settings
        const { error } = reach.call<MailSend>("mail.send", { to: [{ address: input.to }], subject, text, ...(mailboxId === "" ? {} : { mailboxId }) })
        if (error) throw error
        return {}
    }
}
