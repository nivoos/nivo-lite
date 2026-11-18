import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Demo } from "../../../objects/demo.object.ts"
import type { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import { vnLabel } from "../common/vn-time.ts"
import { assertRef } from "../common/typed-ref.ts"

export const BookInput = z.strictObject({
    leadId: z.string().min(1).max(80),
    slots: z.array(z.string().max(40).min(10)).min(1).max(10),
    index: z.number().int().min(0).max(9),
})
/** The demo as the rest of the workflow needs it: its id, the instants it waits on (ms since the epoch), who hosts it, the link and how a person reads its time. */
export const BookOutput = z.strictObject({
    demoId: z.string().max(128),
    atMs: z.number().int().nonnegative(),
    remindAtMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    host: z.string().max(80),
    link: z.string().max(500),
    label: z.string().max(40),
})
/** The business rules of a demo: its host (a member id), the meeting link, how long it lasts and how long before it the lead is reminded. */
export const BookSettings = z.strictObject({
    demoHost: z.string().max(80).default(""),
    meetingLink: z.string().max(500).default(""),
    demoMinutes: z.number().int().min(15).max(240).default(60),
    remindHours: z.number().int().min(0).max(72).default(2),
})

type In = z.infer<typeof BookInput>
type Out = z.infer<typeof BookOutput>
type Settings = z.infer<typeof BookSettings>

/** Books the chosen slot: one act, `object.create` of `gtm.demo` at status `confirmed` with the host, the link and the demo's own next action. */
export class Book implements Node<typeof BookInput, typeof BookOutput, typeof BookSettings> {
    readonly key = keyOf("leads-book")
    readonly version = 3
    readonly title = { vi: "Đặt lịch demo", en: "Book the demo" }
    readonly input = BookInput
    readonly output = BookOutput
    readonly settings = BookSettings
    readonly reads = []
    readonly mutation = "object.create"

    run(input: In, reach: NodeReach<Settings>): Out {
        const at = input.slots.at(input.index)
        if (at === undefined) throw new Error("slot_missing: the chosen slot is not in the list")
        const atMs = Date.parse(at)
        const { demoHost, meetingLink, demoMinutes, remindHours } = reach.settings
        assertRef<Lead>(input.leadId)
        const { result, error } = reach.objects(Demo).create({
            lead: input.leadId,
            status: "confirmed",
            at,
            owner: demoHost === "" ? "nivo-gtm.leads" : demoHost,
            nextAction: "Chuẩn bị demo",
            nextAt: at,
            ...(demoHost === "" ? {} : { host: demoHost }),
            ...(meetingLink === "" ? {} : { link: meetingLink, evidence: meetingLink }),
        })
        if (error) throw error
        return {
            demoId: result.id,
            atMs,
            remindAtMs: atMs - remindHours * 3_600_000,
            endMs: atMs + demoMinutes * 60_000,
            host: demoHost,
            link: meetingLink,
            label: vnLabel(atMs),
        }
    }
}
