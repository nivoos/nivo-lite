import { z } from "zod"
import { NivoField, NivoObjectType, NivoRelation, nivoDateTime, nivoDocument } from "@starci/nivoos-sdk"
import type { NivoRef } from "@starci/nivoos-sdk"
import { Campaign } from "./campaign.object.ts"

export const CONTENT_KINDS = ["video", "post", "article"] as const
export const CONTENT_STATUSES = ["idea", "chosen", "script_review", "script_ok", "producing", "cut_ready", "approved", "published", "dropped", "parked"] as const

/** `gtm.content` (Nội dung): one idea on its way to a published video, post or article. */
@NivoObjectType({ key: "gtm.content", title: { vi: "Nội dung", en: "Content" } })
export class Content {
    @NivoField(z.string().min(1).max(40), { unique: true, indexed: true, title: { vi: "Mã", en: "Code" } }) code!: string
    @NivoField(z.enum(CONTENT_KINDS), { indexed: true, title: { vi: "Loại", en: "Kind" } }) kind!: (typeof CONTENT_KINDS)[number]
    @NivoField(z.string().min(1).max(200), { title: { vi: "Tiêu đề", en: "Title" } }) title!: string
    @NivoField(z.enum(CONTENT_STATUSES), { indexed: true, title: { vi: "Trạng thái", en: "Status" } }) status!: (typeof CONTENT_STATUSES)[number]
    @NivoField(z.string().max(120).optional(), { title: { vi: "Trụ cột", en: "Pillar" } }) pillar?: string
    @NivoField(z.string().max(300).optional(), { title: { vi: "Câu mở đầu", en: "Hook" } }) hook?: string
    @NivoRelation(() => Campaign, { optional: true, title: { vi: "Chiến dịch", en: "Campaign" } }) campaign?: NivoRef<Campaign>
    @NivoField(nivoDocument().optional(), { title: { vi: "Kịch bản", en: "Script" } }) script?: Readonly<Record<string, unknown>>
    @NivoField(z.string().max(3000).optional(), { title: { vi: "Caption", en: "Caption" } }) caption?: string
    @NivoField(z.string().max(500).optional(), { title: { vi: "Thư mục Drive", en: "Drive folder" } }) driveFolder?: string
    @NivoField(z.number().int().min(0).optional(), { title: { vi: "Số lần sửa", en: "Revisions" } }) revisions?: number

    // Responsibility: owner, next action, due time, evidence (G2 role marks follow when the SDK has them).
    @NivoField(z.string().max(80).optional(), { indexed: true, title: { vi: "Người phụ trách", en: "Owner" } }) owner?: string
    @NivoField(z.string().max(300).optional(), { title: { vi: "Việc tiếp theo", en: "Next action" } }) nextAction?: string
    @NivoField(nivoDateTime().optional(), { indexed: true, title: { vi: "Hạn việc tiếp theo", en: "Next action due" } }) nextAt?: string
    @NivoField(z.string().max(2000).optional(), { title: { vi: "Bằng chứng", en: "Evidence" } }) evidence?: string
}
