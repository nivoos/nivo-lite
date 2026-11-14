/**
 * The label a customer's picture or file is read as in front of its caption ("[ảnh] em chuyển rồi"), in the shop's language (Vietnamese: the
 * wake's words have always been Vietnamese). The same words as the conversations bundle's `conversations.imageLabel` /
 * `conversations.fileLabel`: the trigger's translate is pure, so it reads them as constants of the provider, not from the catalog.
 */
export const ZALO_ATTACHMENT_LABELS: Readonly<Record<"image" | "file", string>> = {
    image: "[ảnh]",
    file: "[tệp]",
}

/** What the owner's pages say of the Zalo message trigger and of the members of its data. */
export const ZALO_MESSAGE_WORDS = {
    title: { vi: "Zalo · tin nhắn mới", en: "Zalo · new message" },
    summary: {
        vi: "Khách nhắn cho Official Account (chữ, ảnh hoặc tệp). Tin đến qua webhook của Zalo; nếu webhook không báo, NIVO đọc lại hộp thư của OA nên tin không bị mất.",
        en: "A customer writes to the Official Account (text, a picture or a file). It arrives by Zalo's webhook; if the webhook does not report it, NIVO reads the OA's inbox back, so no message is lost.",
    },
    members: {
        messageKey: {
            vi: "Mã của tin trong NIVO (zalo:<mã tin Zalo>); webhook và đọc lại cho cùng một mã.",
            en: "The message's key in NIVO (zalo:<Zalo message id>); the webhook and the read-back give the same key.",
        },
        text: {
            vi: "Khách viết gì: chữ, hoặc nhãn ảnh / tệp kèm lời chú thích.",
            en: "What the customer wrote: the text, or the label of the picture or file with its caption.",
        },
        at: {
            vi: "Lúc khách gửi (ISO 8601); trống khi sự kiện không có giờ.",
            en: "When the customer sent it (ISO 8601); empty when the event carries no time.",
        },
        attachments: {
            vi: "Ảnh và tệp gửi kèm tin; rỗng với tin chữ.",
            en: "The pictures and files sent with the message; empty for a text.",
        },
    },
} as const
