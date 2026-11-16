import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the vector-sync codes, Vietnamese and English. */
export const VECTOR_SYNC_MESSAGES: MessageBundle = {
    vi: {
        "errors.VECTOR_SYNC_EMBEDDING_UNAVAILABLE": "Chưa nhúng được văn bản để tìm theo nghĩa. Sẽ thử lại sau.",
        "errors.VECTOR_SYNC_INDEX_UNAVAILABLE": "Chưa kết nối được kho tìm theo nghĩa. Sẽ thử lại sau.",
        "errors.VECTOR_SYNC_PAYLOAD_INVALID": "Công việc đồng bộ kho tìm theo nghĩa có dữ liệu không hợp lệ.",
    },
    en: {
        "errors.VECTOR_SYNC_EMBEDDING_UNAVAILABLE": "The text could not be embedded for search by meaning. It will be tried again.",
        "errors.VECTOR_SYNC_INDEX_UNAVAILABLE": "The search-by-meaning index could not be reached. It will be tried again.",
        "errors.VECTOR_SYNC_PAYLOAD_INVALID": "The vector sync job carried data it cannot read.",
    },
}
