import type { MessageBundle } from "@modules/platform/i18n"

/** Display text of the tools codes, Vietnamese and English. */
export const TOOLS_MESSAGES: MessageBundle = {
    vi: {
        "errors.TOOLS_INVALID_ARGUMENTS": "Tham số công cụ không hợp lệ.",
        "errors.TOOLS_UNKNOWN_TOOL": "Không có công cụ này.",
        "errors.TOOLS_INVALID": "Dữ liệu không hợp lệ: {field}.",
        "errors.TOOLS_AGENT_NOT_FOUND": "Không tìm thấy agent trong workspace.",
        "errors.TOOLS_TIMEOUT": "Công cụ trả lời quá chậm.",
        "errors.TOOLS_NATIVE_REFUSED": "Công cụ từ chối yêu cầu này: {reason}.",
        "errors.TOOLS_ATTACHMENT_REFUSED": "Không đổi được quyền của agent trên kết nối này: {reason}.",
        "errors.TOOLS_ACCOUNT_NEEDS_PICK":
            "Agent có nhiều tài khoản {provider} và chưa có tài khoản mặc định cho {tool}: hãy chọn một tài khoản mặc định ({connectionIds}).",
        "errors.TOOLS_ACCOUNT_OTHER_WORLD":
            "Lượt chạy này ở thế giới {world} nhưng agent không có tài khoản {provider} nào của thế giới đó cho {tool}: không gửi gì.",
        "errors.TOOLS_RUN_WORLD_UNDECIDED":
            "Không xác định được lượt chạy là sandbox hay thật, và các tài khoản {provider} cho {tool} thuộc cả hai: hãy đặt tài khoản mặc định.",
    },
    en: {
        "errors.TOOLS_INVALID_ARGUMENTS": "The tool arguments are not valid.",
        "errors.TOOLS_UNKNOWN_TOOL": "There is no such tool.",
        "errors.TOOLS_INVALID": "The input is not valid: {field}.",
        "errors.TOOLS_AGENT_NOT_FOUND": "The agent is not in this workspace.",
        "errors.TOOLS_TIMEOUT": "The tool answered too slowly.",
        "errors.TOOLS_NATIVE_REFUSED": "The tool refused this request: {reason}.",
        "errors.TOOLS_ATTACHMENT_REFUSED": "The agent's rights on this provider cannot be changed: {reason}.",
        "errors.TOOLS_ACCOUNT_NEEDS_PICK":
            "The agent holds several {provider} accounts and has no default account for {tool}: pick a default account ({connectionIds}).",
        "errors.TOOLS_ACCOUNT_OTHER_WORLD":
            "This run acts in the {world} world and the agent holds no {provider} account of that world for {tool}: nothing was sent.",
        "errors.TOOLS_RUN_WORLD_UNDECIDED":
            "Nothing tells whether this run is sandbox or live, and the {provider} accounts for {tool} are of both: set a default account.",
    },
}
