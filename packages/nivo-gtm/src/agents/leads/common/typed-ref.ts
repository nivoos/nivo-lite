import type { NivoContactId, NivoRef } from "@starci/nivoos-sdk"

/**
 * Tells the compiler that an id the engine handed over as text is the typed id of an object of `T` (`NivoRef<T>`, the id `reach.objects(T).get` takes). The SDK has no door that mints a typed id from
 * text, and the ids in a node's input come from the workflow state, which only ever holds ids the engine issued, so this is the one place that vouches for it instead of a cast at each call.
 */
export function assertRef<T>(id: string): asserts id is NivoRef<T> {
    // Nothing to check at run time: the engine answers OBJECTS_OBJECT_NOT_FOUND for an id of no object of the type.
}

/** Same as `assertRef` for the typed contact id (`NivoContactId`) the contact conversation door answers as text. */
export function assertContactId(id: string): asserts id is NivoContactId {
    // Nothing to check at run time: the engine issued the id.
}
