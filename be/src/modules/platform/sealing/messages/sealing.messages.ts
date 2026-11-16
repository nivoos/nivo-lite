import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the sealing codes, Vietnamese and English. */
export const SEALING_MESSAGES: MessageBundle = {
    vi: {
        "errors.SEALING_KEY_INVALID": "Khoá niêm phong không phải 32 byte base64.",
        "errors.SEALING_UNREADABLE": "Không mở được giá trị đã niêm phong bằng khoá hiện tại.",
    },
    en: {
        "errors.SEALING_KEY_INVALID": "The sealing key is not 32 bytes of base64.",
        "errors.SEALING_UNREADABLE": "A sealed value could not be opened with the current key.",
    },
}
