import { TinoError, TinoErrorCode } from "@modules/integrations/tino"
import { tinoFailureOf } from "./tino-domain-registrar.service"
import type { TinoCaseEffect } from "./tino-sandbox.catalogue"

/** What the sandbox says when a call times out (the cause the live client wraps from its transport). */
const NO_ANSWER = "sandbox: no answer in time"

/**
 * The failure the live adapter throws for a Tino client failure of that code: the SAME `TinoError` the client throws, passed through
 * the live adapter's own mapping (`tinoFailureOf`), so the class, the code, the refusal reason and the proof (`not_sent` / `unknown`)
 * are the live ones by construction. The sandbox service builds no Tino error itself: it reaches no integration.
 */
const failureOf = (code: TinoErrorCode, reason: string | null, cause?: unknown): Error => {
    const params = reason === null ? {} : { reason }
    const failure = tinoFailureOf(new TinoError({ code, params, ...(cause === undefined ? {} : { cause }) }))
    return failure instanceof Error ? failure : new Error(NO_ANSWER)
}

/** The route refused the request as asked (its `error` body): the refusal `rejected` carrying Tino's code. */
export const tinoRejected = (code: string): Error => failureOf(TinoErrorCode.Rejected, code)

/** Tino answered a server failure (5xx): the effect is not known (proof `unknown`). */
export const tinoServerError = (): Error => failureOf(TinoErrorCode.Failed, "503")

/** The API could not be reached or did not answer in time: the effect is not known (proof `unknown`). */
export const tinoUnreachable = (): Error => failureOf(TinoErrorCode.Unreachable, null, new Error(NO_ANSWER))

/** Tino refused the token at its gateway (401 `invalid_token`): nothing was sent (proof `not_sent`). */
export const tinoAuthRefused = (): Error => failureOf(TinoErrorCode.AuthFailed, "invalid_token")

/**
 * The failure a case's effect throws BEFORE anything is applied (a refusal at the gateway, a server error, no answer), or null for an
 * effect that is not one of them (the service handles `refused`, `not_found`, `applied_timeout` and `empty` itself). Tino publishes no 429.
 */
export const tinoFailureOfEffect = (effect: TinoCaseEffect | undefined): Error | null => {
    switch (effect) {
        case "auth":
            return tinoAuthRefused()
        case "server":
            return tinoServerError()
        case "timeout":
            return tinoUnreachable()
        default:
            return null
    }
}
