import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import { assertRef } from "./typed-ref.ts"

export const TouchLeadInput = z.strictObject({
    leadId: z.string().min(1).max(80),
    /** One line for the lead's notes: what happened in this touch. */
    note: z.string().min(1).max(300),
    /** The next action to show; empty keeps the default of the settings. */
    nextAction: z.string().max(300),
    /** True: a lead still `new` or gone `cold` is now `engaged`. */
    engage: z.boolean(),
})
export const TouchLeadOutput = z.strictObject({
    leadId: z.string().max(128),
    version: z.number().int(),
    stage: z.string().max(40),
    turns: z.number().int().nonnegative(),
})
export const TouchLeadSettings = z.strictObject({
    /** How long after a touch the lead's next action falls due. */
    followUpHours: z.number().int().min(1).max(720).default(24),
    /** How many note lines a lead keeps (the newest). */
    noteLines: z.number().int().min(3).max(40).default(12),
    defaultNextAction: z.string().max(300).default("Theo dõi khách"),
})

type In = z.infer<typeof TouchLeadInput>
type Out = z.infer<typeof TouchLeadOutput>
type Settings = z.infer<typeof TouchLeadSettings>

/**
 * Records a touch on a lead: one act, `object.update` of `gtm.lead`. It stamps the last contact, appends one line to the fit notes (the lead's running memory, the newest `noteLines`
 * lines), moves a `new` or `cold` lead to `engaged` when asked, and sets the next action and its due time. `turns` is how many lines the notes hold now: the count of touches the
 * readiness rule and the scoring read.
 */
export class TouchLead implements Node<typeof TouchLeadInput, typeof TouchLeadOutput, typeof TouchLeadSettings> {
    readonly key = keyOf("leads-touch-lead")
    readonly version = 3
    readonly title = { vi: "Ghi nhận lần chạm khách", en: "Record a touch on the lead" }
    readonly input = TouchLeadInput
    readonly output = TouchLeadOutput
    readonly settings = TouchLeadSettings
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach<Settings>): Out {
        assertRef<Lead>(input.leadId)
        const got = reach.objects(Lead).get(input.leadId)
        if (got.error) throw got.error
        const lead = got.result
        const now = reach.facts.at
        const notes = (lead.values.fitNotes ?? "").split("\n").filter((line) => line !== "")
        notes.push(`${now.slice(0, 10)} ${input.note}`)
        const kept = notes.slice(-reach.settings.noteLines)
        const stage =
            input.engage && (lead.values.stage === "new" || lead.values.stage === "cold")
                ? "engaged"
                : lead.values.stage
        const { result, error } = reach.objects(Lead).update({
            id: lead.id,
            version: lead.version,
            values: {
                stage,
                lastContactAt: now,
                fitNotes: kept.join("\n").slice(-1500),
                nextAction: input.nextAction === "" ? reach.settings.defaultNextAction : input.nextAction,
                nextAt: new Date(Date.parse(now) + reach.settings.followUpHours * 3_600_000).toISOString(),
            },
        })
        if (error) throw error
        return { leadId: result.id, version: result.version, stage: result.values.stage, turns: kept.length }
    }
}
