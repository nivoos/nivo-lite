import { z } from "zod"
import { NivoField, NivoObjectType, nivoDate, nivoDateTime, nivoMoney } from "@starci/nivoos-sdk"

export const CAMPAIGN_STATUSES = ["draft", "active", "done"] as const

/** `gtm.campaign` (Chiến dịch): a push toward a goal on some channels, over a period. */
@NivoObjectType({ key: "gtm.campaign", title: { vi: "Chiến dịch", en: "Campaign" } })
export class Campaign {
    @NivoField(z.string().min(1).max(40), { unique: true, indexed: true, title: { vi: "Mã", en: "Code" } }) code!: string
    @NivoField(z.string().min(1).max(200), { title: { vi: "Tên chiến dịch", en: "Title" } }) title!: string
    @NivoField(z.enum(CAMPAIGN_STATUSES), { indexed: true, title: { vi: "Trạng thái", en: "Status" } }) status!: (typeof CAMPAIGN_STATUSES)[number]
    @NivoField(z.string().max(500).optional(), { title: { vi: "Mục tiêu", en: "Goal" } }) goal?: string
    @NivoField(z.string().max(120).optional(), { title: { vi: "Trụ cột nội dung", en: "Pillar" } }) pillar?: string
    @NivoField(z.string().max(200).optional(), { title: { vi: "Kênh", en: "Channels" } }) channels?: string
    @NivoField(nivoDate().optional(), { title: { vi: "Bắt đầu", en: "Start" } }) startOn?: string
    @NivoField(nivoDate().optional(), { title: { vi: "Kết thúc", en: "End" } }) endOn?: string
    @NivoField(z.number().int().min(0).optional(), { title: { vi: "Mục tiêu khách", en: "Target leads" } }) targetLeads?: number
    @NivoField(nivoMoney().min(0).optional(), { title: { vi: "Ngân sách (giá giữ chỗ)", en: "Budget (placeholder)" } }) budget?: number
    @NivoField(z.string().max(1000).optional(), { title: { vi: "Ghi chú", en: "Notes" } }) notes?: string

    // Responsibility: every object has an accountable owner, a next action, a due time and evidence. The engine role marks (G2) are added here when the SDK has them.
    @NivoField(z.string().max(80).optional(), { indexed: true, title: { vi: "Người phụ trách", en: "Owner" } }) owner?: string
    @NivoField(z.string().max(300).optional(), { title: { vi: "Việc tiếp theo", en: "Next action" } }) nextAction?: string
    @NivoField(nivoDateTime().optional(), { indexed: true, title: { vi: "Hạn việc tiếp theo", en: "Next action due" } }) nextAt?: string
    @NivoField(z.string().max(2000).optional(), { title: { vi: "Bằng chứng", en: "Evidence" } }) evidence?: string
}
