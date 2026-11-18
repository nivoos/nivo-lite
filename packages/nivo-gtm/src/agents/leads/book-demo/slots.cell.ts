import { z } from "zod"
import type { Node, NodeReach, NivoValues } from "@starci/nivoos-sdk"
import { Demo } from "../../../objects/demo.object.ts"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import { minutesOf, vnLabel, vnMidnight, vnWeekday } from "../common/vn-time.ts"
import { assertRef } from "../common/typed-ref.ts"

export const SlotsInput = z.strictObject({ leadId: z.string().min(1).max(80), phase: z.enum(["invite", "pick"]) })
/** `found` false: no invitation to make (`reason` says why). `slots` are the free demo times (ISO instants) and `labels` the same times as a person reads them, in the same order. */
export const SlotsOutput = z.strictObject({
    found: z.boolean(),
    reason: z.string().max(120),
    code: z.string().max(60),
    name: z.string().max(120),
    slots: z.array(z.string().max(40)).max(10),
    labels: z.array(z.string().max(120)).max(10),
})
/** The business rules of the demo calendar: the times of day, the weekdays (0 Sunday to 6 Saturday), how many to offer, how far ahead to look and how soon a slot may start. */
export const SlotsSettings = z.strictObject({
    demoSlots: z
        .array(
            z
                .string()
                .max(5)
                .regex(/^[0-2]\d:[0-5]\d$/u),
        )
        .min(1)
        .max(12)
        .default(["10:00", "14:00", "16:00"]),
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
/** The stages from which a demo is no longer offered: it is booked or held, or the lead is won, lost or unfit. */
const CLOSED_STAGES: ReadonlySet<string> = new Set(["demo_booked", "demo_done", "won", "lost", "unfit"])
const INVITED_ACTION = "Chờ khách chọn giờ demo"

/** Why a lead gets no invitation or pick list right now (its stage is past the demo, it asked not to be contacted, or it was invited a moment ago), or null when it may be offered times. */
function closedReason(lead: NivoValues<Lead>, phase: In["phase"], now: number, reinviteHours: number): string | null {
    if (lead.doNotContact === true) return "do_not_contact"
    if (CLOSED_STAGES.has(lead.stage)) return `stage_${lead.stage}`
    const invitedAt = lead.lastContactAt === undefined ? Number.NaN : Date.parse(lead.lastContactAt)
    if (phase === "invite" && lead.nextAction === INVITED_ACTION && now - invitedAt < reinviteHours * 3_600_000)
        return "already_invited"
    return null
}

/** The next `slotCount` demo times (ISO instants) on the calendar's weekdays and times of day, from `minLeadHours` ahead, that no held demo (`taken`, epoch ms) occupies. */
function freeSlots(now: number, taken: ReadonlySet<number>, settings: Settings): Array<string> {
    const times = [...settings.demoSlots].sort((left, right) => left.localeCompare(right))
    const earliest = now + settings.minLeadHours * 3_600_000
    const first = vnMidnight(now)
    const slots: Array<string> = []
    for (let day = 0; day <= settings.horizonDays && slots.length < settings.slotCount; day += 1) {
        const midnight = first + day * 86_400_000
        if (!settings.weekdays.includes(vnWeekday(midnight + 43_200_000))) continue
        for (const time of times) {
            const at = midnight + minutesOf(time) * 60_000
            if (at < earliest || taken.has(at) || slots.length >= settings.slotCount) continue
            slots.push(new Date(at).toISOString())
        }
    }
    return slots
}

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
    readonly reads = ["object.get", "object.aggregate"]

    run(input: In, reach: NodeReach<Settings>): Out {
        assertRef<Lead>(input.leadId)
        const got = reach.objects(Lead).get(input.leadId)
        if (got.error) throw got.error
        const lead = got.result.values
        const none = (reason: string): Out => ({
            found: false,
            reason,
            code: lead.code,
            name: lead.name ?? "",
            slots: [],
            labels: [],
        })
        const now = Date.parse(reach.facts.at)
        const closed = closedReason(lead, input.phase, now, reach.settings.reinviteHours)
        if (closed !== null) return none(closed)
        const held = reach.objects(Demo).aggregate({
            where: { status: { in: ["proposed", "confirmed"] } },
            groupBy: "at",
            aggregates: [{ op: "count", as: "total" }],
        })
        if (held.error) throw held.error
        const taken = new Set(held.result.rows.map((row) => (row.group === null ? 0 : Date.parse(row.group))))
        const slots = freeSlots(now, taken, reach.settings)
        if (slots.length === 0) return none("no_free_slot")
        return {
            found: true,
            reason: "",
            code: lead.code,
            name: lead.name ?? "",
            slots,
            labels: slots.map((slot) => vnLabel(Date.parse(slot))),
        }
    }
}
