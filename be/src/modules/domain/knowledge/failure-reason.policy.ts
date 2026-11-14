/**
 * The reason a dead letter carries, as the runner hands it to a processor's `onFailed` (a flow failure whose params name the class and
 * the reason: the failure's code, or its message); undefined when the cause carries none.
 */
export const reasonOf = (cause: unknown): string | undefined => {
    if (typeof cause !== "object" || cause === null || !("params" in cause)) return undefined
    const params: unknown = cause.params
    if (typeof params !== "object" || params === null || !("reason" in params)) return undefined
    return typeof params.reason === "string" ? params.reason : undefined
}
