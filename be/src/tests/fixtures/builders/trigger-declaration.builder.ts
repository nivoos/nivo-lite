import { TRIGGER } from "@nivo-lite/agent-sdk/names"
import { z } from "zod"
import type { TriggerDeclaration } from "@modules/domain/provider-triggers"

/*
 * Declarations of the one shape for the specs that test how the readers (the switch page, the provider offer, the registry reads, the
 * registration checks) read a trigger: a bank movement (a switch, decided, received by webhook AND poll), a mailbox's mail (a switch, no
 * decider, received by poll alone) and a render completion (switch on by default, webhook only, with its reason). They are fixtures, not the
 * providers' own declarations: a spec registers the ones it reads (`triggerDeclarations.register(...)`).
 */

/** What every fixture leaves blank: no raw to translate, no event. */
const BLANK = { raw: z.object({}).passthrough(), translate: () => null } as const

/** A bank movement: id and direction (a closed choice), received by its webhook and by its poll; one agent decides on it. */
export const bankTriggerOf = (overrides: Partial<TriggerDeclaration> = {}): TriggerDeclaration => ({
    provider: "sepay",
    name: "transaction.received",
    verb: TRIGGER.paymentCreditReceived,
    via: ["webhook", "poll"],
    dataType: "sepay.transaction",
    words: {
        title: { vi: "Ngân hàng · tiền vào tài khoản", en: "Bank · money received" },
        summary: {
            vi: "Một khoản tiền vào tài khoản ngân hàng đã kết nối.",
            en: "A movement of money on the connected bank account.",
        },
        members: {
            transactionId: { vi: "Mã giao dịch của ngân hàng.", en: "The bank's id of the movement." },
            direction: { vi: "Tiền vào hay tiền ra.", en: "Money in or out." },
        },
    },
    switch: { decided: true, onByDefault: false },
    data: z.object({ transactionId: z.string(), direction: z.enum(["in", "out"]) }),
    key: { by: "data", member: "transactionId" },
    ...BLANK,
    ...overrides,
})

/** A mailbox's mail: the mail's id, received by the connection poll alone; off until the owner switches it on, nobody decides. */
export const mailTriggerOf = (overrides: Partial<TriggerDeclaration> = {}): TriggerDeclaration => ({
    provider: "imap",
    name: "mail.received",
    verb: TRIGGER.mailMessageReceived,
    via: ["poll"],
    dataType: "imap.mail",
    words: {
        title: { vi: "Hộp thư · thư mới", en: "Mailbox · new mail" },
        summary: { vi: "Một người đã gửi thư vào hộp thư.", en: "A person mailed the mailbox." },
        members: { mailId: { vi: "Mã của thư trong hộp thư.", en: "The mail's id in the mailbox." } },
    },
    switch: { decided: false, onByDefault: false },
    data: z.object({ mailId: z.string() }),
    key: { by: "data", member: "mailId" },
    ...BLANK,
    ...overrides,
})

/** A render completion of a compose provider: on by default (it reports work NIVO asked for), received by webhook only, with its reason. */
export const renderTriggerOf = (provider = "shotstack", overrides: Partial<TriggerDeclaration> = {}): TriggerDeclaration => ({
    provider,
    name: "render.completed",
    verb: TRIGGER.videoRenderCompleted,
    via: ["webhook"],
    withoutPoll: {
        reason: {
            vi: "Một video do NIVO yêu cầu dựng; lượt chạy chờ nó tự đọc trạng thái khi quá hạn.",
            en: "A video NIVO asked for; the waiting run reads the render's status when it runs out.",
        },
        source: "nivo:wait-timeout",
    },
    dataType: `${provider}.render`,
    words: {
        title: { vi: "Dựng video · hoàn tất", en: "Video render · completed" },
        summary: { vi: "Một video NIVO yêu cầu dựng đã xong hoặc lỗi.", en: "A render NIVO asked for finished, done or failed." },
        members: { renderId: { vi: "Mã của lượt dựng.", en: "The render's id." } },
    },
    switch: { decided: false, onByDefault: true },
    data: z.object({ renderId: z.string(), status: z.enum(["done", "failed"]) }),
    key: { by: "data", member: "renderId" },
    ...BLANK,
    ...overrides,
})
