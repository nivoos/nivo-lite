import { z } from "zod"
import type { Node, NodeReach, NivoRef } from "@starci/nivoos-sdk"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import { minutesOf, vnMidnight, VN_OFFSET_MS } from "../common/vn-time.ts"

export const CheckFollowUpInput = z.strictObject({ leadId: z.string().min(1).max(80) })
/**
 * What the nurture loop does next: `send` (a follow-up is due and inside the sending window), `wait` (until `waitUntilMs`), `cold` (the lead has had every follow-up and stays silent) or `stop`
 * (the lead is no longer one to follow up: a demo is booked, it is won, lost or unfit, or it asked not to be contacted). `nextDueMs` is when the follow-up after this one falls due (0: none).
 */
export const CheckFollowUpOutput = z.strictObject({
    action: z.enum(["send", "wait", "cold", "stop"]),
    waitUntilMs: z.number().int().nonnegative(),
    nextDueMs: z.number().int().nonnegative(),
    code: z.string().max(60),
    followUps: z.number().int().nonnegative(),
    reason: z.string().min(1).max(200),
})
/** The business rules of the nurture: the gaps in days between follow-ups, how many are sent, and the hours (Vietnam time) in which a message may be sent. */
export const CheckFollowUpSettings = z.strictObject({
    followUpDays: z.array(z.number().int().min(1).max(90)).min(1).max(10).default([1, 3, 7, 14]),
    maxFollowUps: z.number().int().min(1).max(10).default(4),
    sendFrom: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/u).default("08:00"),
    sendTo: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/u).default("21:00"),
})

type In = z.infer<typeof CheckFollowUpInput>
type Out = z.infer<typeof CheckFollowUpOutput>
type Settings = z.infer<typeof CheckFollowUpSettings>

const DAY_MS = 86_400_000

/**
 * `nivo-gtm.leads-check-follow-up` (Đến lúc nhắn lại chưa): the decision of the nurture loop, from the lead as it stands NOW (so a reply the lead wrote meanwhile, which moved its last contact, moves
 * the due time with it). Due is the last contact plus the gap for the follow-up number; a due message waits for the sending window (`sendFrom` to `sendTo`, Vietnam time). A decision node: it reads only.
 */
export class CheckFollowUp implements Node<typeof CheckFollowUpInput, typeof CheckFollowUpOutput, typeof CheckFollowUpSettings> {
    readonly key = keyOf("leads-check-follow-up")
    readonly version = 1
    readonly title = { vi: "Đến lúc nhắn lại chưa", en: "Is a follow-up due" }
    readonly input = CheckFollowUpInput
    readonly output = CheckFollowUpOutput
    readonly settings = CheckFollowUpSettings
    readonly reads = ["object.get"]

    run(input: In, reach: NodeReach<Settings>): Out {
        const got = reach.objects(Lead).get(input.leadId as NivoRef<Lead>)
        if (got.error) throw got.error
        const lead = got.result.values
        const now = Date.parse(reach.facts.at)
        const sent = lead.followUps ?? 0
        const base = { code: lead.code, followUps: sent, waitUntilMs: 0, nextDueMs: 0 }
        if (lead.doNotContact === true) return { ...base, action: "stop", reason: "Khách không muốn bị liên hệ" }
        if (lead.stage !== "engaged" && lead.stage !== "qualified") return { ...base, action: "stop", reason: `Giai đoạn ${lead.stage}: không còn nhắn theo dõi` }
        if (sent >= reach.settings.maxFollowUps) return { ...base, action: "cold", reason: "Đã nhắn đủ số lần, khách chưa phản hồi" }
        const days = reach.settings.followUpDays
        const gapOf = (count: number): number => (days[Math.min(count, days.length - 1)] ?? 1) * DAY_MS
        const lastMs = lead.lastContactAt === undefined ? now : Date.parse(lead.lastContactAt)
        const dueMs = lastMs + gapOf(sent)
        if (dueMs > now) return { ...base, action: "wait", waitUntilMs: dueMs, reason: "Chưa đến hạn nhắn lại" }
        const minute = Math.floor((((now + VN_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / 60_000)
        const from = minutesOf(reach.settings.sendFrom)
        const to = minutesOf(reach.settings.sendTo)
        if (minute < from || minute >= to) {
            const opens = vnMidnight(now) + from * 60_000
            return { ...base, action: "wait", waitUntilMs: now < opens ? opens : opens + DAY_MS, reason: "Ngoài giờ được nhắn khách" }
        }
        const nextDueMs = sent + 1 < reach.settings.maxFollowUps ? now + gapOf(sent + 1) : 0
        return { ...base, action: "send", nextDueMs, reason: "Đến hạn nhắn lại" }
    }
}
