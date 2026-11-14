import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the data stores codes, Vietnamese and English. */
export const DATA_STORES_MESSAGES: MessageBundle = {
    vi: {
        "errors.DATA_STORES_SCOPE_REQUIRED": "Thiếu workspace: kho dữ liệu luôn đọc và ghi trong một workspace.",
        "errors.DATA_STORES_SCOPE_UNKNOWN": "Không tìm thấy workspace này, hoặc có nhiều workspace cùng tên.",
        "errors.DATA_STORES_STORAGE_UNAVAILABLE": "Kho tệp chưa trả lời được. Hãy thử lại sau.",
        "errors.DATA_STORES_RECORD_INVALID": "Bản ghi không đúng cấu trúc của tập dữ liệu.",
        "errors.DATA_STORES_KNOWLEDGE_META_DOOR_MISSING":
            "Ứng dụng này chưa có cửa đổi chủ đề, module hay quyền xem của tài liệu mà không đổi nội dung.",
    },
    en: {
        "errors.DATA_STORES_SCOPE_REQUIRED":
            "No workspace named: a data store always reads and writes inside one workspace.",
        "errors.DATA_STORES_SCOPE_UNKNOWN": "That workspace was not found, or several workspaces carry the name.",
        "errors.DATA_STORES_STORAGE_UNAVAILABLE": "The file storage did not answer. Try again later.",
        "errors.DATA_STORES_RECORD_INVALID": "The record does not match the schema of its set.",
        "errors.DATA_STORES_KNOWLEDGE_META_DOOR_MISSING":
            "This app has no door that changes a document's topic, module or visibility without its text.",
    },
}
