import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the remote files codes, Vietnamese and English. */
export const REMOTE_FILES_MESSAGES: MessageBundle = {
    vi: {
        "errors.REMOTE_FILES_REQUEST_FAILED": "Không đọc được tệp ở địa chỉ này.",
        "errors.REMOTE_FILES_UNAVAILABLE": "Địa chỉ này đang bận hoặc lỗi. Sẽ thử đọc lại sau.",
    },
    en: {
        "errors.REMOTE_FILES_REQUEST_FAILED": "The file at this address could not be read.",
        "errors.REMOTE_FILES_UNAVAILABLE": "This address is busy or failing. It will be read again shortly.",
    },
}
