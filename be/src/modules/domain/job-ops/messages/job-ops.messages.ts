import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the jobs operations codes the person's door can answer, Vietnamese and English. */
export const JOB_OPS_MESSAGES: MessageBundle = {
    vi: {
        "errors.JOB_OPS_STOPPED_WORK_NEEDS_OWNER": "Chỉ chủ không gian làm việc mới xem, chạy lại hoặc đóng được việc đã dừng.",
        "errors.JOB_OPS_STOPPED_WORK_REASON_INVALID": "Lý do đóng cần từ 1 đến {{max}} ký tự.",
    },
    en: {
        "errors.JOB_OPS_STOPPED_WORK_NEEDS_OWNER": "Only the workspace owner can view, resume or close stopped work.",
        "errors.JOB_OPS_STOPPED_WORK_REASON_INVALID": "The reason to close needs 1 to {{max}} characters.",
    },
}
