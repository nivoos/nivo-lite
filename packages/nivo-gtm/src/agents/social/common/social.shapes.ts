import { z } from "zod"

/** A card choice: the value the answer carries and the words on the button. */
export const Choice = z.strictObject({ value: z.string().min(1).max(60), label: z.string().min(1).max(60) })

/** The channels the calendar plans for. The first is live; the others are the provider seam ("chờ kết nối"). */
export const Channel = z.enum(["telegram", "facebook", "tiktok", "youtube", "zalo"])

/** A room answer as `engine.room.answered` carries it. */
export const RoomAnswer = z.strictObject({
    answerKey: z.string(),
    messageId: z.string(),
    roomId: z.string(),
    runId: z.string(),
    stepKey: z.string(),
    choice: z.string(),
    memberId: z.string(),
})

/** The `{ objectId }` a start wait keeps of the object write that opened the run. */
export const Changed = z.strictObject({ objectId: z.string().min(1) })

/** What a card cell hands to the shared `PostCard` step. */
export const CardParts = z.strictObject({ cardText: z.string().min(1).max(3000), choices: z.array(Choice).max(6) })

/** One planned slot of the week. */
export const Slot = z.strictObject({
    contentId: z.string().min(1),
    contentCode: z.string().min(1).max(40),
    channel: Channel,
    at: z.string().min(10).max(40),
    why: z.string().max(300),
})

/** A post draft as the model writes it. `ok` is false only when a revision was refused (the cap is reached). */
export const PostDraft = z.strictObject({
    ok: z.boolean(),
    revision: z.number().int().min(0).max(20),
    caption: z.string().max(2500),
    hashtags: z.array(z.string().max(60)).max(12),
    imageText: z.string().max(200),
})

/** The review window of a card: when it is first due, and when the nudge is. */
export const ReviewWindow = z.strictObject({ reviewBy: z.string().min(10), secondReviewBy: z.string().min(10) })
