import { z } from "zod"
import { NivoField, NivoObjectType, NivoRelation, nivoDateTime, type NivoRef } from "@starci/nivoos-sdk"
import { Content } from "./content.object.ts"

export const VIDEO_CUT_VERDICTS = ["pending", "fix", "approved"] as const

@NivoObjectType({ key: "gtm.video-cut", title: { vi: "Bản dựng", en: "Video cut" } })
/** `gtm.video-cut` (Bản dựng): one cut of a video; its verdict is its state. */
export class VideoCut {
    @NivoRelation(() => Content, { title: { vi: "Nội dung", en: "Content" } }) content!: NivoRef<Content>
    @NivoField(z.number().int().min(1), { indexed: true, title: { vi: "Phiên bản", en: "Version" } }) version!: number
    @NivoField(z.string().min(1).max(500), { title: { vi: "Liên kết tệp", en: "File link" } }) fileLink!: string
    @NivoField(z.number().int().min(0).optional(), { title: { vi: "Số giây", en: "Seconds" } }) seconds?: number
    @NivoField(z.enum(VIDEO_CUT_VERDICTS), { indexed: true, title: { vi: "Kết luận", en: "Verdict" } })
    verdict!: (typeof VIDEO_CUT_VERDICTS)[number]
    @NivoField(z.string().max(80).optional(), { title: { vi: "Người duyệt", en: "Reviewer" } }) reviewer?: string
    @NivoField(z.string().max(1000).optional(), { title: { vi: "Ghi chú", en: "Note" } }) note?: string

    // Responsibility: owner, next action, due time, evidence (G2 role marks follow when the SDK has them).
    @NivoField(z.string().max(80).optional(), { indexed: true, title: { vi: "Người phụ trách", en: "Owner" } })
    owner?: string
    @NivoField(z.string().max(300).optional(), { title: { vi: "Việc tiếp theo", en: "Next action" } })
    nextAction?: string
    @NivoField(nivoDateTime().optional(), { indexed: true, title: { vi: "Hạn việc tiếp theo", en: "Next action due" } })
    nextAt?: string
    @NivoField(z.string().max(2000).optional(), { title: { vi: "Bằng chứng", en: "Evidence" } }) evidence?: string
}
