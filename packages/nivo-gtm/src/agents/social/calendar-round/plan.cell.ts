import { z } from "zod"
import type { ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { dayAfter, slotInstant } from "../common/helpers.ts"
import { SOCIAL_POLICY } from "../common/social.policy.ts"
import { Slot } from "../common/social.shapes.ts"
import { ReadOutput } from "./read.cell.ts"

export const PlanOutput = z.strictObject({ slots: z.array(Slot).max(40) })
const ModelSlot = z.strictObject({
    contentId: z.string().max(80),
    contentCode: z.string().max(40),
    channel: z.string().max(20),
    dayOffset: z.number().int().min(1).max(7),
    hour: z.string().max(5),
    why: z.string().max(300),
})
const ModelPlan = z.strictObject({ slots: z.array(ModelSlot).max(40) })
/** The cadence: posts per week per channel (Telegram is live; the others are "chờ kết nối", so 0) and the hours a post may go out. */
export const PlanSettings = z.strictObject({
    telegramPerWeek: z.number().int().min(0).max(14).default(5),
    facebookPerWeek: z.number().int().min(0).max(14).default(0),
    tiktokPerWeek: z.number().int().min(0).max(14).default(0),
    youtubePerWeek: z.number().int().min(0).max(14).default(0),
    publishHours: z
        .array(
            z
                .string()
                .max(5)
                .regex(/^\d{2}:\d{2}$/u),
        )
        .min(1)
        .max(6)
        .default(["11:30", "19:30"]),
})

type In = z.infer<typeof ReadOutput>
type Out = z.infer<typeof PlanOutput>
type Settings = z.infer<typeof PlanSettings>
type ModelOut = z.infer<typeof ModelPlan>

const GOAL =
    "Plan next week's posts. `items` are approved content ready to go out; `limits` is how many posts a channel may have this week; `hours` are the only hours a post may go out; `dayOffset` is the number of days after `instant` (1 to 7). " +
    "Place each item on a channel (only a channel with a limit above 0), a day and one of the hours; spread the days, do not put two posts on one channel at the same hour, learn from `metrics`. Say why in `why`. Place nothing else: never invent a content id."

/**
 * `nivo-gtm.social-plan` (Lên lịch tuần): ONE generation. The model places the ready items on channels, days and hours; the cell then keeps only slots that fit the cadence settings (a channel with a limit of 0 is "chờ kết nối") and
 * turns each day and hour into the instant of the post (Ho Chi Minh City time).
 */
export class SocialPlan implements Node<typeof ReadOutput, typeof PlanOutput, typeof PlanSettings> {
    readonly key = keyOf("social-plan")
    readonly version = 1
    readonly title = { vi: "Lên lịch đăng tuần", en: "Plan the week" }
    readonly input = ReadOutput
    readonly output = PlanOutput
    readonly settings = PlanSettings
    readonly reads = []
    readonly mutation = "model.generate"
    readonly model = { model: "sonnet-5-5", effort: "balanced" } as const

    run(input: In, reach: NodeReach<Settings>): Out {
        const limits: Record<string, number> = {
            telegram: reach.settings.telegramPerWeek,
            facebook: reach.settings.facebookPerWeek,
            tiktok: reach.settings.tiktokPerWeek,
            youtube: reach.settings.youtubePerWeek,
        }
        const { result, error } = reach.call<ModelGenerate<ModelOut>>("model.generate", {
            prompt: `${SOCIAL_POLICY}\n\n${GOAL}`,
            data: {
                instant: input.instant,
                items: input.items,
                metrics: input.metrics,
                limits,
                hours: reach.settings.publishHours,
            },
        })
        if (error) throw error
        const known = new Set(input.items.map((item) => item.id))
        const used: Record<string, number> = {}
        const slots: Array<z.infer<typeof Slot>> = []
        for (const slot of result.value.slots) {
            const channel = slot.channel
            if (!known.has(slot.contentId) || !reach.settings.publishHours.includes(slot.hour)) continue
            if (channel !== "telegram" && channel !== "facebook" && channel !== "tiktok" && channel !== "youtube")
                continue
            const count = used[channel] ?? 0
            if (count >= (limits[channel] ?? 0)) continue
            used[channel] = count + 1
            slots.push({
                contentId: slot.contentId,
                contentCode: slot.contentCode,
                channel,
                at: slotInstant(dayAfter(input.instant, slot.dayOffset), slot.hour),
                why: slot.why,
            })
        }
        return { slots }
    }
}
