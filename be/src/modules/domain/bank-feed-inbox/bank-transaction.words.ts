import type { TriggerDeclaration } from "@modules/domain/provider-triggers"

/** The owner's words of a trigger, as its declaration holds them. */
type TriggerOwnerWords = TriggerDeclaration["words"]

/** Why a trigger received by no poll loses no event, as its declaration holds it. */
type TriggerWithoutPoll = NonNullable<TriggerDeclaration["withoutPoll"]>

/**
 * What the owner's switch page says of the bank feeds' transaction trigger (moved here from the retired provider-trigger catalogue): its
 * title, what it is, and what each member of its `data` means.
 */
export const BANK_TRANSACTION_WORDS: TriggerOwnerWords = {
    title: { vi: "Ngân hàng · tiền vào tài khoản", en: "Bank · money received" },
    summary: {
        vi: "Có giao dịch mới trên tài khoản ngân hàng (tiền vào hoặc tiền ra).",
        en: "A new movement on the bank account (money in or money out).",
    },
    members: {
        transactionId: {
            vi: "Mã giao dịch của nhà cung cấp; đọc chi tiết qua công cụ giao dịch ngân hàng.",
            en: "The provider's own id of the movement; read its details through the bank transaction tool.",
        },
        direction: {
            vi: "Chiều tiền: in là tiền vào, out là tiền ra.",
            en: "The direction of the money: in is a credit, out is a debit.",
        },
        amountVnd: { vi: "Số tiền (VND).", en: "The amount in VND." },
        content: { vi: "Nội dung chuyển khoản ngân hàng hiển thị.", en: "The transfer content the bank shows." },
        at: { vi: "Thời điểm ngân hàng ghi nhận.", en: "When the bank booked it." },
        account: { vi: "Số tài khoản ngân hàng của giao dịch.", en: "The bank account the movement belongs to." },
        bankRef: { vi: "Mã tham chiếu của chính ngân hàng.", en: "The bank's own reference of the movement." },
        payKey: {
            vi: "Khóa nhận diện khoản thanh toán: mã yêu cầu thanh toán của nhà cung cấp (payOS) hoặc nội dung chuyển khoản (SePay, Casso).",
            en: "What the payment is identified by: the provider's payment-request reference (payOS) or the transfer content (SePay, Casso).",
        },
    },
}

/**
 * Casso is received by its webhook only: NIVO holds no Casso API key (the connection keeps the integration's secure key, which proves the
 * webhook, not a read), so there is no poll receiver. Casso re-delivers itself: verified words below.
 */
export const CASSO_WITHOUT_POLL: TriggerWithoutPoll = {
    reason: {
        vi: "Casso tự gửi lại webhook khi thất bại: lần đầu sau 1 phút, giãn theo dãy Fibonacci, tối đa 17 lần; cấu hình tạm dừng sau 24 giờ lỗi liên tiếp và giữ sự kiện để gửi lại khi sửa xong, tắt sau 7 ngày.",
        en: "Casso re-sends a failed webhook itself: first retry after 1 minute, growing along the Fibonacci sequence, up to 17 attempts; the configuration pauses after 24 hours of consecutive failures and holds the events for a resend once fixed, and is disabled after 7 days.",
    },
    source: "https://developer.casso.vn/webhook/thiet-lap-webhook-thu-cong.md",
}

/**
 * payOS is received by its webhook only. NOT VERIFIED: payOS's public documents state no retry policy, and it has no transaction list (only a
 * per-link read that needs the link ids NIVO keeps in its own order table, which a receiver may not read), so no receiver is possible.
 * This is the safer declaration, said as it is.
 */
export const PAYOS_WITHOUT_POLL: TriggerWithoutPoll = {
    reason: {
        vi: "CHƯA XÁC MINH: tài liệu payOS không nêu chính sách gửi lại webhook và payOS không có API liệt kê giao dịch (chỉ đọc từng link thanh toán, cần danh sách link nằm trong bảng đơn của NIVO); chỉ nhận qua webhook.",
        en: "NOT VERIFIED: payOS's documents state no webhook retry policy and payOS has no transaction list (only a per-link read that needs the link ids kept in NIVO's own order table); received by webhook only.",
    },
    source: "https://payos.vn/docs/du-lieu-tra-ve/webhook/",
}
