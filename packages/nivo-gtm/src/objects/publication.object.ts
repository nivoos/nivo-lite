import { z } from "zod"
import { NivoField, NivoObjectType, NivoRelation, nivoDateTime } from "@starci/nivoos-sdk"
import type { NivoRef } from "@starci/nivoos-sdk"
import { Content } from "./content.object.ts"

export const PUBLICATION_CHANNELS = ["zalo", "telegram", "facebook", "tiktok", "youtube"] as const
export const PUBLICATION_STATUSES = ["planned", "scheduled", "published", "failed", "parked", "cancelled"] as const

/** `gtm.publication` (Lượt đăng): one content item on one channel at one time, with what it reached. */
@NivoObjectType({ key: "gtm.publication", title: { vi: "Lượt đăng", en: "Publication" } })
export class Publication {
    @NivoRelation(() => Content, { title: { vi: "Nội dung", en: "Content" } }) content!: NivoRef<Content>
    @NivoField(z.string().min(1).max(120), { unique: true, indexed: true, title: { vi: "Khóa lượt đăng", en: "Slot key" } }) slotKey!: string
    @NivoField(z.enum(PUBLICATION_CHANNELS), { indexed: true, title: { vi: "Kênh", en: "Channel" } }) channel!: (typeof PUBLICATION_CHANNELS)[number]
    @NivoField(z.enum(PUBLICATION_STATUSES), { indexed: true, title: { vi: "Trạng thái", en: "Status" } }) status!: (typeof PUBLICATION_STATUSES)[number]
    @NivoField(nivoDateTime().optional(), { indexed: true, title: { vi: "Giờ đăng", en: "At" } }) at?: string
    @NivoField(z.string().max(40).optional(), { indexed: true, title: { vi: "Mã theo dõi", en: "Ref code" } }) refCode?: string
    @NivoField(z.string().max(500).optional(), { title: { vi: "Liên kết bài", en: "Url" } }) url?: string
    @NivoField(z.number().int().min(0).optional(), { title: { vi: "Lượt xem", en: "Views" } }) views?: number
    @NivoField(z.number().int().min(0).optional(), { title: { vi: "Tiếp cận", en: "Reach" } }) reach?: number
    @NivoField(z.number().int().min(0).optional(), { title: { vi: "Tương tác", en: "Engagements" } }) engagements?: number
    @NivoField(z.number().int().min(0).optional(), { title: { vi: "Lượt bấm", en: "Clicks" } }) clicks?: number
    @NivoField(z.number().int().min(0).optional(), { title: { vi: "Khách từ bài", en: "Leads" } }) leads?: number
    @NivoField(nivoDateTime().optional(), { title: { vi: "Số liệu lúc", en: "Metrics at" } }) metricsAt?: string

    // Responsibility: owner, next action, due time, evidence (G2 role marks follow when the SDK has them).
    @NivoField(z.string().max(80).optional(), { indexed: true, title: { vi: "Người phụ trách", en: "Owner" } }) owner?: string
    @NivoField(z.string().max(300).optional(), { title: { vi: "Việc tiếp theo", en: "Next action" } }) nextAction?: string
    @NivoField(nivoDateTime().optional(), { indexed: true, title: { vi: "Hạn việc tiếp theo", en: "Next action due" } }) nextAt?: string
    @NivoField(z.string().max(2000).optional(), { title: { vi: "Bằng chứng", en: "Evidence" } }) evidence?: string
}
