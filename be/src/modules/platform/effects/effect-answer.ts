import type { JobEffectDeclaration } from "@modules/platform/jobs"
import type { Effects } from "./effects.port"
import { EffectsError, EffectsErrorCode } from "./errors/effects.error"

/** The act of an effect whose answer the caller needs. */
export type Act<T> = () => Promise<T>

/** What an act answered, once it has. */
interface Answered<T> {
    /** The answer. */
    readonly value: T
}

/** Where the act of one `onceAnswered` call leaves its answer. */
interface Made<T> {
    /** The answer, absent until the act has been made. */
    answer?: Answered<T>
}

/**
 * Makes an outside act through the effects port and answers what the act answered. For an act whose answer is too large or too soon
 * to keep on the ledger row (a model answer, a document read, vectors): the call keeps nothing, so the answer is taken from inside the
 * act. Only a `repeatable` effect belongs here: it is always made again under its key when its outcome was lost, so it always answers.
 */
export const onceAnswered = async <T>(effects: Effects, key: string, effect: JobEffectDeclaration, act: Act<T>): Promise<T> => {
    const made: Made<T> = {}
    await effects.once(key, effect, {
        act: async () => {
            made.answer = { value: await act() }
        },
    })
    if (made.answer === undefined) throw new EffectsError({ code: EffectsErrorCode.Unanswered, params: { effect: effect.name, key } })
    return made.answer.value
}
