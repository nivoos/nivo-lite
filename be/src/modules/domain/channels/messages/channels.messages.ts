import type { MessageBundle } from "@modules/platform/i18n"
import type { FieldWords } from "@modules/domain/connection-fields"

/** The reason stored on a Zalo connection whose refresh token Zalo refused: the owner reads it on Connections, in Vietnamese as the product does. */
export const ZALO_RECONNECT_REASON = "Zalo OA cần được kết nối lại (token hết hạn hoặc bị thu hồi). Bấm Kết nối lại."

/** The reason stored on a Zalo connection whose authorization could not be completed: the owner reads it on Connections. */
export const ZALO_AUTHORIZATION_FAILED_REASON = "Không hoàn tất được việc cấp quyền Zalo. Bấm Kết nối lại để thử lại."

/** What the owner reads, as a work item, when the OA plan does not let the connection answer customers: Vietnamese as the product does. */
export const CHANNEL_PLAN_NOTICE =
    "Gói OA hiện tại không cho gửi tin tư vấn cho khách; nâng gói OA để NIVO trả lời được trên Zalo"

/** Display text of the channels codes, Vietnamese and English. */
export const CHANNELS_MESSAGES: MessageBundle = {
    vi: {
        "errors.CHANNELS_CONNECTION_NOT_FOUND": "Không tìm thấy kết nối này.",
        "errors.CHANNELS_SECRET_UNREADABLE": "Không đọc được thông tin đăng nhập của kết nối.",
        "errors.CHANNELS_ZALO_NOT_AUTHORIZED": "Kết nối Zalo chưa được cấp quyền. Hãy bấm Kết nối lại.",
        "errors.CHANNELS_ZALO_REFRESH_BUSY": "Zalo đang làm mới mã truy cập, hãy thử lại sau giây lát.",
        "errors.CHANNELS_ZALO_STATE_REJECTED": "Phiên cấp quyền Zalo không hợp lệ.",
        "errors.CHANNELS_ZALO_STATE_EXPIRED": "Phiên cấp quyền Zalo đã hết hạn, hãy bắt đầu lại.",
        "errors.CHANNELS_ZALO_KEPT_PAIR_UNREADABLE": "Không đọc được mã truy cập Zalo đã lưu. Hãy kết nối lại Zalo OA.",
        "errors.CHANNELS_WIZARD_STOPPED": "Bước kết nối Zalo chưa hoàn tất được. Hãy thử lại.",
        "errors.CHANNELS_PAYLOAD_INVALID": "Công việc kết nối có dữ liệu không hợp lệ.",
        "errors.CHANNELS_SEND_UNAVAILABLE": "Kênh chưa nhận tin lúc này, tin chưa được gửi; hệ thống sẽ thử lại sau.",
    },
    en: {
        "errors.CHANNELS_CONNECTION_NOT_FOUND": "That connection was not found.",
        "errors.CHANNELS_SECRET_UNREADABLE": "The credential of the connection could not be read.",
        "errors.CHANNELS_ZALO_NOT_AUTHORIZED": "The Zalo connection is not authorized yet. Press Reconnect.",
        "errors.CHANNELS_ZALO_REFRESH_BUSY": "Zalo is refreshing the access token, try again in a moment.",
        "errors.CHANNELS_ZALO_STATE_REJECTED": "The Zalo authorization session is not valid.",
        "errors.CHANNELS_ZALO_STATE_EXPIRED": "The Zalo authorization session expired, start again.",
        "errors.CHANNELS_ZALO_KEPT_PAIR_UNREADABLE": "The stored Zalo access tokens could not be read. Reconnect the Zalo OA.",
        "errors.CHANNELS_WIZARD_STOPPED": "The Zalo connection step could not be completed. Try again.",
        "errors.CHANNELS_PAYLOAD_INVALID": "The connection job carries invalid data.",
        "errors.CHANNELS_SEND_UNAVAILABLE": "The channel is not taking messages right now; nothing was sent, it is tried again later.",
    },
}

/** The words of a Zalo OA's connection form fields (Kết nối card). */
export const ZALO_FIELD_WORDS: Readonly<Record<"oaName" | "oaId" | "appId" | "webhookUrl" | "oaSecret", FieldWords>> = {
    oaName: { vi: "Tên OA", en: "OA name" },
    oaId: { vi: "Mã OA", en: "OA id" },
    appId: { vi: "App ID", en: "App ID" },
    webhookUrl: { vi: "Webhook URL", en: "Webhook URL" },
    oaSecret: { vi: "OA Secret Key", en: "OA Secret Key" },
}
