/** What the owner's pages say of the Zalo message trigger and of the members of its data. */
export const ZALO_MESSAGE_WORDS = {
    title: { vi: "Zalo · tin nhắn mới", en: "Zalo · new message" },
    summary: {
        vi: "Khách nhắn cho Official Account (chữ, ảnh, nhãn dán, âm thanh, video, tệp, liên kết, vị trí hoặc danh thiếp). Tin đến qua webhook của Zalo; nếu webhook không báo, NIVO đọc lại hộp thư của OA nên tin không bị mất.",
        en: "A customer writes to the Official Account (text, a picture, a sticker, audio, a video, a file, a link, a location or a contact card). It arrives by Zalo's webhook; if the webhook does not report it, NIVO reads the OA's inbox back, so no message is lost.",
    },
    members: {
        messageKey: {
            vi: "Mã của tin trong NIVO (zalo:<mã tin Zalo>); webhook và đọc lại cho cùng một mã.",
            en: "The message's key in NIVO (zalo:<Zalo message id>); the webhook and the read-back give the same key.",
        },
        text: {
            vi: "Khách viết gì (lời chú thích nếu tin có ảnh hay tệp); rỗng khi tin chỉ có phần đính kèm.",
            en: "What the customer wrote (the caption of a picture or a file); empty for a message of parts only.",
        },
        at: {
            vi: "Lúc khách gửi (ISO 8601); trống khi sự kiện không có giờ.",
            en: "When the customer sent it (ISO 8601); empty when the event carries no time.",
        },
        attachments: {
            vi: "Mọi phần gửi kèm tin (ảnh, nhãn dán, âm thanh, video, tệp; liên kết, vị trí, danh thiếp là phần không có tệp); rỗng với tin chữ.",
            en: "Every part sent with the message (picture, sticker, audio, video, file; a link, a location, a contact card are parts with no file); empty for a text.",
        },
    },
} as const
