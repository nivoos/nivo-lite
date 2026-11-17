import { z } from "zod"
import type { Node, NodeReach, NivoRef } from "@starci/nivoos-sdk"
import { Demo } from "../../../objects/demo.object.ts"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import { minutesOf, vnLabel, vnMidnight, vnWeekday } from "../common/vn-time.ts"

export const SlotsInput = z.strictObject({ leadId: z.string().min(1).max(80), phase: z.enum(["invite", "pick"]) })
/** `found` false: no invitation to make (`reason` says why). `slots` are the free demo times (ISO instants) and `labels` the same times as a person reads them, in the same order. */
export const SlotsOutput = z.strictObject({
    found: z.boolean(),
    reason: z.string().max(120),
    code: z.string().max(60),
    name: z.string().max(120),
    slots: z.array(z.string()).max(10),
    labels: z.array(z.string()).max(10),
})
/** The business rules of the demo calendar: the times of day, the weekdays (0 Sunday to 6 Saturday), how many to offer, how far ahead to look and how soon a slot may start. */
export const SlotsSettings = z.strictObject({
    demoSlots: z.array(z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/u)).min(1).max(12).default(["10:00", "14:00", "16:00"]),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5]),
    slotCount: z.number().int().min(1).max(6).default(3),
    horizonDays: z.number().int().min(1).max(60).default(10),
    minLeadHours: z.number().int().min(0).max(168).default(2),
    /** A lead already invited this recently is not invited again. */
    reinviteHours: z.number().int().min(0).max(720).default(24),
})

type In = z.infer<typeof SlotsInput>
type Out = z.infer<typeof SlotsOutput>
type Settings = z.infer<typeof SlotsSettings>

/** What the lead's next action reads after an invitation: the invitation step writes it and this cell reads it back. */
const INVITED_ACTION = "Chờ khách chọn giờ demo"

/**
 * `nivo-gtm.leads-slots` (Các giờ demo còn trống): the next `slotCount` fixed demo times (the times of day in `demoSlots` on the `weekdays`, Vietnam time, from `minLeadHours` ahead) that no
 * `gtm.demo` holds (a demo `proposed` or `confirmed` at that instant). Google Calendar replaces this when it is connected. A lead that is booked, won, lost, unfit or does not want contact gets
 * none, and an invitation sent within `reinviteHours` is not sent twice. A decision node: it reads only.
 */
export class Slots implements Node<typeof SlotsInput, typeof SlotsOutput, typeof SlotsSettings> {
    readonly key = keyOf("leads-slots")
    readonly version = 1
    readonly title = { vi: "Các giờ demo còn trống", en: "Free demo slots" }
    readonly input = SlotsInput
    readonly output = SlotsOutput
    readonly settings = SlotsSettings
    readonly reads = ["object.get", "object.query"]

    run(input: In, reach: NodeReach<Settings>): Out {
        const got = reach.objects(Lead).get(input.leadId as NivoRef<Lead>)
        if (got.error) throw got.error
        const lead = got.result.values
        const none = (reason: string): Out => ({ found: false, reason, code: lead.code, name: lead.name ?? "", slots: [], labels: [] })
        const now = Date.parse(reach.facts.at)
        if (lead.doNotContact === true) return none("do_not_contact")
        if (lead.stage === "demo_booked" || lead.stage === "demo_done" || lead.stage === "won" || lead.stage === "lost" || lead.stage === "unfit") return none(`stage_${lead.stage}`)
        if (input.phase === "invite" && lead.nextAction === INVITED_ACTION && lead.lastContactAt !== undefined && now - Date.parse(lead.lastContactAt) < reach.settings.reinviteHours * 3_600_000) return none("already_invited")
        const held = reach.objects(Demo).query({ where: { status: { in: ["proposed", "confirmed"] } }, limit: 200 })
        if (held.error) throw held.error
        const taken = held.result.items.map((demo) => (demo.values.at === undefined ? 0 : Date.parse(demo.values.at)))
        const times = [...reach.settings.demoSlots].sort()
        const earliest = now + reach.settings.minLeadHours * 3_600_000
        const first = vnMidnight(now)
        const slots: string[] = []
        for (let day = 0; day <= reach.settings.horizonDays && slots.length < reach.settings.slotCount; day += 1) {
            const midnight = first + day * 86_400_000
            if (!reach.settings.weekdays.includes(vnWeekday(midnight + 43_200_000))) continue
            for (const time of times) {
                const at = midnight + minutesOf(time) * 60_000
                if (at < earliest || taken.includes(at) || slots.length >= reach.settings.slotCount) continue
                slots.push(new Date(at).toISOString())
            }
        }
        if (slots.length === 0) return none("no_free_slot")
        return { found: true, reason: "", code: lead.code, name: lead.name ?? "", slots, labels: slots.map((slot) => vnLabel(Date.parse(slot))) }
    }
}
