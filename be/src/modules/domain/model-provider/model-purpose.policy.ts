import type { WorkScope } from "@modules/platform/logging"
import { MODEL_CALL_OPERATION } from "./model-sandbox.catalogue"

/** The longest purpose a sandbox call is logged and picked under (the store's operation and key are at most 200 characters). */
export const MODEL_PURPOSE_MAX = 200

/**
 * The PURPOSE a model call is logged and picked under on a sandbox model account: the call's own metering purpose (`<node id>:<tag>`),
 * else the open work scope's `<kind>:<step key>` (a document's reading: `document_read:triage`, `document_read:extract`) or its kind,
 * else `call`. The same words the meter books, so the call log shows the purpose a case can be picked for.
 */
export const modelPurposeOf = (purpose: string | null, work: WorkScope | null): string => {
    const named = purpose ?? (work === null ? null : work.stepKey === null || work.stepKey === undefined ? work.kind : `${work.kind}:${work.stepKey}`)
    const trimmed = named?.trim() ?? ""
    return trimmed === "" ? MODEL_CALL_OPERATION : trimmed.slice(0, MODEL_PURPOSE_MAX)
}
