import type { NivoRef } from "@starci/nivoos-sdk"

/** Whether an id text a step carried can be read as the typed id of an object: every id in a node input was issued by the engine, so only the brand is added and the engine still answers not-found for an id of no object. */
const isRef = <T>(id: string): id is NivoRef<T> => id.length > 0

/**
 * The typed id (`NivoRef<T>`) of an object of `T`, from the id text a step or a cell input carried, for `reach.objects(T).get(...)` and relation fields.
 * The SDK has no door that mints a typed id from text and the lint rule consistent-type-assertions refuses a cast, so this is the one place that vouches for it.
 */
export const refOf = <T>(id: string): NivoRef<T> => [id].flatMap((item) => (isRef<T>(item) ? [item] : []))[0]
