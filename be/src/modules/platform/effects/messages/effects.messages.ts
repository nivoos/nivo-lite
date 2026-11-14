import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the effects codes, Vietnamese and English. */
export const EFFECTS_MESSAGES: MessageBundle = {
    vi: {
        "errors.EFFECTS_OUTCOME_UNKNOWN": "Không rõ thao tác bên ngoài {{effect}} đã xảy ra hay chưa; cần người quyết định có làm lại hay không.",
        "errors.EFFECTS_CONFIRM_MISSING": "Thao tác bên ngoài {{effect}} cần cách kiểm tra kết quả nhưng chưa khai báo.",
        "errors.EFFECTS_INTENT_MISSING": "Thao tác bên ngoài {{effect}} chưa được ghi nhận là đã bắt đầu.",
        "errors.EFFECTS_CONNECTION_MISSING": "Năng lực thao tác bên ngoài chưa được khai báo kết nối cơ sở dữ liệu.",
        "errors.EFFECTS_LEDGER_ROW_REJECTED": "Một dòng sổ thao tác bên ngoài có dạng không hợp lệ.",
        "errors.EFFECTS_UNANSWERED": "Thao tác bên ngoài {{effect}} không có kết quả để trả lại; chỉ thao tác được làm lại mới trả được kết quả.",
        "errors.EFFECTS_SEALING_MISSING": "Thao tác bên ngoài {{effect}} giữ một giá trị bí mật nhưng năng lực chưa được khai báo khoá niêm phong.",
    },
    en: {
        "errors.EFFECTS_OUTCOME_UNKNOWN": "It is not known whether the outside act {{effect}} happened; a person decides whether to act again.",
        "errors.EFFECTS_CONFIRM_MISSING": "The outside act {{effect}} needs a way to confirm its outcome but none was given.",
        "errors.EFFECTS_INTENT_MISSING": "The outside act {{effect}} was never recorded as begun.",
        "errors.EFFECTS_CONNECTION_MISSING": "The effects capability was registered with no database connection.",
        "errors.EFFECTS_LEDGER_ROW_REJECTED": "An outside-act ledger row has a shape no code writes.",
        "errors.EFFECTS_UNANSWERED": "The outside act {{effect}} left no answer to give back; only a repeatable act answers.",
        "errors.EFFECTS_SEALING_MISSING": "The outside act {{effect}} keeps a secret but the capability was registered with no sealing key.",
    },
}
