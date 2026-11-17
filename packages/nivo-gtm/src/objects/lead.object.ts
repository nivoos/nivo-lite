import { z } from "zod"
import { NivoContact, NivoField, NivoObjectType, NivoRelation, nivoDateTime } from "@starci/nivoos-sdk"
import type { NivoContactId, NivoRef } from "@starci/nivoos-sdk"
import { Campaign } from "./campaign.object.ts"
import { Publication } from "./publication.object.ts"

export const LEAD_STAGES = ["new", "engaged", "qualified", "demo_booked", "demo_done", "won", "cold", "unfit", "lost"] as const

/** `gtm.lead` (Khách tiềm năng): a person or business that may buy NIVO, from first touch to won or lost. */
@NivoObjectType({ key: "gtm.lead", title: { vi: "Khách tiềm năng", en: "Lead" } })
export class Lead {
    @NivoField(z.string().min(1).max(40), { unique: true, indexed: true, title: { vi: "Mã", en: "Code" } }) code!: string
    @NivoContact({ optional: true, title: { vi: "Liên hệ", en: "Contact" } }) contact?: NivoContactId
    @NivoField(z.string().max(120).optional(), { title: { vi: "Tên", en: "Name" } }) name?: string
    @NivoField(z.string().max(30).optional(), { indexed: true, title: { vi: "Điện thoại", en: "Phone" } }) phone?: string
    @NivoField(z.string().max(20).optional(), { title: { vi: "Kênh chat", en: "Chat channel" } }) channel?: string
    @NivoField(z.string().max(80).optional(), { title: { vi: "Mã người dùng trên kênh", en: "Id on the channel" } }) chatRef?: string
    @NivoField(z.string().max(160).optional(), { title: { vi: "Doanh nghiệp", en: "Business" } }) business?: string
    @NivoField(z.string().max(80).optional(), { title: { vi: "Nhóm khách", en: "Segment" } }) segment?: string
    @NivoField(z.enum(LEAD_STAGES), { indexed: true, title: { vi: "Giai đoạn", en: "Stage" } }) stage!: (typeof LEAD_STAGES)[number]
    @NivoField(z.string().max(60).optional(), { indexed: true, title: { vi: "Nguồn", en: "Source" } }) source?: string
    @NivoRelation(() => Publication, { optional: true, title: { vi: "Bài dẫn tới", en: "Source publication" } }) sourcePublication?: NivoRef<Publication>
    @NivoRelation(() => Campaign, { optional: true, title: { vi: "Chiến dịch", en: "Campaign" } }) campaign?: NivoRef<Campaign>
    @NivoField(z.number().int().min(0).max(100).optional(), { title: { vi: "Điểm", en: "Score" } }) score?: number
    @NivoField(z.string().max(1500).optional(), { title: { vi: "Ghi chú phù hợp", en: "Fit notes" } }) fitNotes?: string
    @NivoField(z.number().int().min(0).optional(), { title: { vi: "Số lần theo dõi", en: "Follow-ups" } }) followUps?: number
    @NivoField(z.number().int().min(0).optional(), { title: { vi: "Số lượt trao đổi", en: "Turns" } }) turns?: number
    @NivoField(nivoDateTime().optional(), { title: { vi: "Liên hệ gần nhất", en: "Last contact" } }) lastContactAt?: string
    @NivoField(z.string().max(500).optional(), { title: { vi: "Lý do mất", en: "Lost reason" } }) lostReason?: string
    @NivoField(z.boolean().optional(), { title: { vi: "Không liên hệ", en: "Do not contact" } }) doNotContact?: boolean

    // Responsibility: owner, next action, due time, evidence (G2 role marks follow when the SDK has them).
    @NivoField(z.string().max(80).optional(), { indexed: true, title: { vi: "Người phụ trách", en: "Owner" } }) owner?: string
    @NivoField(z.string().max(300).optional(), { title: { vi: "Việc tiếp theo", en: "Next action" } }) nextAction?: string
    @NivoField(nivoDateTime().optional(), { indexed: true, title: { vi: "Hạn việc tiếp theo", en: "Next action due" } }) nextAt?: string
    @NivoField(z.string().max(2000).optional(), { title: { vi: "Bằng chứng", en: "Evidence" } }) evidence?: string
}
