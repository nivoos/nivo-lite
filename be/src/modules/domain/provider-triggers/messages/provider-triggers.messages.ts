import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the provider triggers codes, Vietnamese and English. */
export const PROVIDER_TRIGGERS_MESSAGES: MessageBundle = {
    vi: {
        "errors.PROVIDER_TRIGGERS_UNDECLARED": "Provider của tài khoản này không có trigger tên đó.",
        "errors.PROVIDER_TRIGGERS_UNKNOWN_ACCOUNT": "Không tìm thấy tài khoản kết nối này trong workspace.",
        "errors.PROVIDER_TRIGGERS_NOT_DECIDED":
            "Trigger này không có agent quyết định: mọi agent đã đăng ký đều chỉ được báo tin.",
        "errors.PROVIDER_TRIGGERS_CORE_DECIDES":
            "Agent lõi đang quyết định các sự kiện của tài khoản này; chỉ chọn được agent khác khi không còn agent lõi.",
        "errors.PROVIDER_TRIGGERS_NOT_ATTACHED": "Agent này chưa được gắn với tài khoản kết nối.",
        "errors.PROVIDER_TRIGGERS_DECLARATION_TAKEN": "Đã có một khai báo trigger khác cùng nguồn và cùng tên.",
        "errors.PROVIDER_TRIGGERS_DECLARATION_UNKNOWN": "Khai báo trigger này chưa được đăng ký cho nguồn của nó.",
        "errors.PROVIDER_TRIGGERS_DECLARATION_STREAMLESS": "Khai báo trigger gộp sự kiện theo luồng nhưng không ghi vào luồng nào của hệ thống.",
    },
    en: {
        "errors.PROVIDER_TRIGGERS_UNDECLARED": "The provider of this account declares no trigger of that name.",
        "errors.PROVIDER_TRIGGERS_UNKNOWN_ACCOUNT": "This workspace has no such connected account.",
        "errors.PROVIDER_TRIGGERS_NOT_DECIDED":
            "Nobody decides on this trigger's events: every registered agent is only told.",
        "errors.PROVIDER_TRIGGERS_CORE_DECIDES":
            "The core agent decides on this account's events; another agent can be chosen only where no core agent is bound.",
        "errors.PROVIDER_TRIGGERS_NOT_ATTACHED": "This agent is not attached to the connected account.",
        "errors.PROVIDER_TRIGGERS_DECLARATION_TAKEN": "Another trigger declaration of the same source and name is registered.",
        "errors.PROVIDER_TRIGGERS_DECLARATION_UNKNOWN": "This trigger declaration is not registered for its source.",
        "errors.PROVIDER_TRIGGERS_DECLARATION_STREAMLESS": "This trigger declaration combines its events as a stream but feeds no engine stream.",
    },
}

/** What the owner reads when an event could not be handed to an agent: kept on the account, in Vietnamese as the product does. */
export const TRIGGER_DEAD_NOTICE =
    "Một sự kiện từ kết nối này không giao được cho agent sau nhiều lần thử. Sự kiện được giữ lại, không bị mất. Hãy kiểm tra agent và quy trình đã đăng ký."
