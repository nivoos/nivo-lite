import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the jobs operations codes the person's door can answer, Vietnamese and English. */
export const JOB_OPS_MESSAGES: MessageBundle = {
    vi: {
        "errors.JOB_OPS_STOPPED_WORK_NEEDS_OWNER": "Chỉ chủ không gian làm việc mới xem, chạy lại hoặc đóng được việc đã dừng.",
        "errors.JOB_OPS_STOPPED_WORK_REASON_INVALID": "Lý do đóng cần từ 1 đến {{max}} ký tự.",
        "errors.JOB_OPS_STOPPED_WORK_NOT_FOUND": "Không có việc nào như vậy trong không gian làm việc này.",
        "errors.JOB_OPS_STOPPED_WORK_ALREADY_CLOSED": "Việc này đã được đóng, không chạy lại hay đóng thêm được.",
        "errors.JOB_OPS_STOPPED_WORK_NOT_STOPPED": "Việc này không ở trạng thái dừng chờ xử lý.",
    },
    en: {
        "errors.JOB_OPS_STOPPED_WORK_NEEDS_OWNER": "Only the workspace owner can view, resume or close stopped work.",
        "errors.JOB_OPS_STOPPED_WORK_REASON_INVALID": "The reason to close needs 1 to {{max}} characters.",
        "errors.JOB_OPS_STOPPED_WORK_NOT_FOUND": "No such job in this workspace.",
        "errors.JOB_OPS_STOPPED_WORK_ALREADY_CLOSED": "This job is already closed: it can be neither resumed nor closed again.",
        "errors.JOB_OPS_STOPPED_WORK_NOT_STOPPED": "This job is not stopped waiting for a fix.",
    },
}
