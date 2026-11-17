import { z } from "zod"

/** What a content item is: a short video, or a post the Social agent drafts. */
export const IdeaFormat = z.enum(["video", "post"])

/** One idea the weekly round makes (the plan's list: pillar, hook, angle, format, target segment, why now). */
export const Idea = z.strictObject({
    title: z.string().min(1).max(200),
    pillar: z.string().min(1).max(120),
    hook: z.string().min(1).max(300),
    angle: z.string().min(1).max(400),
    format: IdeaFormat,
    segment: z.string().min(1).max(200),
    whyNow: z.string().min(1).max(300),
})

/** A card choice: the value the answer carries and the words on the button. */
export const Choice = z.strictObject({ value: z.string().min(1).max(60), label: z.string().min(1).max(60) })

/** One beat of a script: when, what is on screen, what is said. */
export const ScriptBeat = z.strictObject({ at: z.string().max(20), onScreen: z.string().max(200), voiceOver: z.string().max(500) })

/**
 * A script draft as the model writes it: the hook (0-3 s), the beats with on-screen text and voice-over, the b-roll list, the call to action, the caption and the length in seconds.
 * `ok` is false only when a revision was refused (the cap `maxRevisions` is reached): the other members are then empty.
 */
export const ScriptDraft = z.strictObject({
    ok: z.boolean(),
    revision: z.number().int().min(0).max(20),
    hook: z.string().max(400),
    beats: z.array(ScriptBeat).max(12),
    broll: z.array(z.string().max(200)).max(12),
    cta: z.string().max(300),
    caption: z.string().max(1000),
    seconds: z.number().int().min(0).max(600),
})

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

/** What a card cell hands to the `ask-team` step: the words and the choices. */
export const CardParts = z.strictObject({ cardText: z.string().min(1).max(3000), choices: z.array(Choice).max(6) })
