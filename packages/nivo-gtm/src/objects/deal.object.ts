import { z } from "zod"
import { NivoField, NivoObjectType, NivoRelation, NivoSequence, nivoDateTime, nivoMoney } from "@starci/nivoos-sdk"
import type { NivoCode, NivoRef } from "@starci/nivoos-sdk"
import { Lead } from "./lead.object.ts"

export const DEAL_STATUSES = ["proposal", "quoted", "accepted", "awaiting_payment", "paid", "activated", "lost"] as const
export type DealStatus = (typeof DEAL_STATUSES)[number]

/**
 * `gtm.deal` (Đơn bán): one sale of a NIVO plan to a lead. `code` is issued by the engine (`NIVO00000042`, a sequence) and IS the pay code: SePay reads it from the transfer memo, so a workspace prefix must be 2 to 5 capital letters.
 * `demoRef` is the demo the deal came from: the natural key a repeat of the hand-over finds the same deal by (an upsert), so one demo is never two deals.
 */
@NivoObjectType({ key: "gtm.deal", title: { vi: "Đơn bán", en: "Deal" } })
export class Deal {
    @NivoSequence({ prefix: "NIVO", width: 8, title: { vi: "Mã đơn", en: "Code" } }) code!: NivoCode
    @NivoField(z.string().min(1).max(80).optional(), { unique: true, indexed: true, title: { vi: "Buổi demo gốc", en: "Source demo" } }) demoRef?: string
    @NivoRelation(() => Lead, { title: { vi: "Khách", en: "Lead" } }) lead!: NivoRef<Lead>
    @NivoField(z.enum(DEAL_STATUSES), { indexed: true, title: { vi: "Trạng thái", en: "Status" } }) status!: DealStatus
    @NivoField(z.string().max(60).optional(), { title: { vi: "Gói", en: "Plan" } }) plan?: string
    @NivoField(z.number().int().min(1).max(36).optional(), { title: { vi: "Số tháng", en: "Months" } }) months?: number
    @NivoField(z.string().max(60).optional(), { title: { vi: "Gói credit", en: "Credit pack" } }) creditPack?: string
    @NivoField(nivoMoney().min(0).optional(), { title: { vi: "Số tiền", en: "Amount" } }) amount?: number
    @NivoField(z.number().min(0).max(100).optional(), { title: { vi: "Giảm giá (%)", en: "Discount (%)" } }) discountPercent?: number
    @NivoField(z.string().max(40).optional(), { indexed: true, title: { vi: "Mã chuyển khoản", en: "Pay code" } }) payCode?: string
    @NivoField(nivoDateTime().optional(), { title: { vi: "Đã thu lúc", en: "Paid at" } }) paidAt?: string
    @NivoField(z.string().max(80).optional(), { title: { vi: "Giao dịch SePay", en: "SePay ref" } }) sepayRef?: string
    @NivoField(z.string().max(120).optional(), { title: { vi: "Workspace khách", en: "Customer workspace" } }) workspaceRef?: string
    @NivoField(nivoDateTime().optional(), { title: { vi: "Kích hoạt lúc", en: "Activated at" } }) activatedAt?: string

    // Responsibility: owner, next action, due time, evidence (G2 role marks follow when the SDK has them).
    @NivoField(z.string().max(80).optional(), { indexed: true, title: { vi: "Người phụ trách", en: "Owner" } }) owner?: string
    @NivoField(z.string().max(300).optional(), { title: { vi: "Việc tiếp theo", en: "Next action" } }) nextAction?: string
    @NivoField(nivoDateTime().optional(), { indexed: true, title: { vi: "Hạn việc tiếp theo", en: "Next action due" } }) nextAt?: string
    @NivoField(z.string().max(2000).optional(), { title: { vi: "Bằng chứng", en: "Evidence" } }) evidence?: string
}
