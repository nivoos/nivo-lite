import { z } from "zod"
import { NivoField, NivoObjectType, NivoRelation, nivoDateTime, type NivoRef } from "@starci/nivoos-sdk"
import { Lead } from "./lead.object.ts"

export const DEMO_STATUSES = ["proposed", "confirmed", "done", "no_show", "moved", "cancelled"] as const

@NivoObjectType({ key: "gtm.demo", title: { vi: "Buổi demo", en: "Demo" } })
/** `gtm.demo` (Buổi demo): one demo of NIVO to one lead. */
export class Demo {
    @NivoRelation(() => Lead, { title: { vi: "Khách", en: "Lead" } }) lead!: NivoRef<Lead>
    @NivoField(z.enum(DEMO_STATUSES), { indexed: true, title: { vi: "Trạng thái", en: "Status" } })
    status!: (typeof DEMO_STATUSES)[number]
    @NivoField(nivoDateTime().optional(), { indexed: true, title: { vi: "Giờ demo", en: "At" } }) at?: string
    @NivoField(z.string().max(80).optional(), { title: { vi: "Người demo", en: "Host" } }) host?: string
    @NivoField(z.string().max(500).optional(), { title: { vi: "Liên kết họp", en: "Link" } }) link?: string
    @NivoField(z.string().max(1500).optional(), { title: { vi: "Kết quả", en: "Outcome note" } }) outcome?: string

    // Responsibility: owner, next action, due time, evidence (G2 role marks follow when the SDK has them).
    @NivoField(z.string().max(80).optional(), { indexed: true, title: { vi: "Người phụ trách", en: "Owner" } })
    owner?: string
    @NivoField(z.string().max(300).optional(), { title: { vi: "Việc tiếp theo", en: "Next action" } })
    nextAction?: string
    @NivoField(nivoDateTime().optional(), { indexed: true, title: { vi: "Hạn việc tiếp theo", en: "Next action due" } })
    nextAt?: string
    @NivoField(z.string().max(2000).optional(), { title: { vi: "Bằng chứng", en: "Evidence" } }) evidence?: string
}
