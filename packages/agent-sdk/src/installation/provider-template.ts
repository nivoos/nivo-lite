import { isCrmId } from "../names/crm"
import { crmOpsOf } from "../names/crm-codegen"
import { SdkDefinitionError } from "../block/definition-error"
import type { ProviderSandboxAnswer, ProviderSandboxOperation, ProviderTemplate, ProviderTemplateAuth } from "./installation.types"

/** A header name a key may be sent in. */
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/u

/** A path under the API base URL: slash-led, no query, no fragment, no template. */
const SWAGGER_PATH = /^\/[A-Za-z0-9._~/-]*$/u

/** The longest label and hint kept, in characters. */
const TEXT_MAX = 200

/** A label in both product languages, each non-empty and bounded. */
const labelled = (label: ProviderTemplate["label"]): boolean =>
    [label.vi, label.en].every((text) => text.trim() !== "" && text.length <= TEXT_MAX)

const authValid = (auth: ProviderTemplateAuth): boolean => auth.type === "bearer" || HEADER_NAME.test(auth.name)

/** An object that is neither null nor an array. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** True when the pinned document looks like an OpenAPI 3 document with paths (structural only; the engine reads it whole). */
const openApiShaped = (document: unknown): boolean => {
    if (!isPlainObject(document)) return false
    const { openapi, paths } = document
    return typeof openapi === "string" && /^3\.[01]\./u.test(openapi) && typeof paths === "object" && paths !== null
}

/** A status of the given range, whole. */
const statusIn = (answer: ProviderSandboxAnswer, least: number, most: number): boolean =>
    Number.isInteger(answer.status) && answer.status >= least && answer.status <= most

/** A text a collection, a key field or a parameter is named by. */
const named = (text: string): boolean => text.trim() !== "" && text.length <= 100

/** True when a sandbox answer of one operation is whole: a 2xx default, a 4xx refusal, a 5xx failure, at most one kind of state. */
const sandboxOperationValid = (operation: ProviderSandboxOperation): boolean => {
    if (!statusIn(operation, 200, 299)) return false
    if (operation.refused !== undefined && !statusIn(operation.refused, 400, 499)) return false
    if (operation.failed !== undefined && !statusIn(operation.failed, 500, 599)) return false
    const { keeps, readsBack, listsBack } = operation
    if ([keeps, readsBack, listsBack].filter((state) => state !== undefined).length > 1) return false
    if (keeps !== undefined && !(named(keeps.collection) && named(keeps.keyField))) return false
    const { reuses } = keeps ?? {}
    if (reuses !== undefined && !(reuses.by.length > 0 && reuses.by.every(named) && (reuses.whileIn === undefined || (named(reuses.whileIn.field) && reuses.whileIn.values.every(named))))) return false
    if (readsBack !== undefined && !(named(readsBack.collection) && named(readsBack.keyParam))) return false
    return listsBack === undefined || (named(listsBack.collection) && named(listsBack.listField))
}

/** True when every sandbox answer names an operation of the pinned document (by its ONE name) and is whole. */
const sandboxValid = (template: ProviderTemplate): boolean => {
    if (template.sandbox === undefined) return true
    const ops = crmOpsOf(template.openapi, template.id)
    if (!ops.ok) return false
    const known = new Set(ops.entries.map((entry) => entry.op))
    return Object.entries(template.sandbox).every(([op, operation]) => known.has(op) && sandboxOperationValid(operation))
}

/**
 * Declares a provider a package supports through its OpenAPI document (owner decided 2026-11-14), listed in the plugin's `providers`:
 * today `kind: "crm"` (a CRM connected through its OpenAPI document). `id` is the FIXED, globally unique id (`nivoweb`), declared here
 * ONLY; the package pins the document it is written against (`openapi`, its `src/crm/<id>/openapi.json`) and codegens its operation
 * constants from the same document. `swaggerPath` is where a live system serves its document under the API base URL the shop enters;
 * `auth` how the key is sent; `baseUrlHint` the example base URL the connect wizard shows; `docs` a link to the system's documentation;
 * `sandbox` what the system answers on a NIVO Sandbox account, by operation (each must be one the document serves).
 * Throws `SdkDefinitionError` `ID_MALFORMED` for an id, path, auth, label or document of the wrong form, `PROVIDER_SANDBOX_INVALID` for a
 * sandbox answer naming no operation of the document or of the wrong status or state.
 */
export const defineProviderTemplate = <const T extends ProviderTemplate>(template: T): T => {
    const at = `provider:${template.kind}:${template.id}`
    if (template.kind !== "crm" || !isCrmId(template.id)) throw new SdkDefinitionError("ID_MALFORMED", at)
    if (!SWAGGER_PATH.test(template.swaggerPath) || !authValid(template.auth)) throw new SdkDefinitionError("ID_MALFORMED", at)
    if (!labelled(template.label) || template.baseUrlHint.length > TEXT_MAX) throw new SdkDefinitionError("ID_MALFORMED", at)
    if (!openApiShaped(template.openapi)) throw new SdkDefinitionError("ID_MALFORMED", at)
    if (!sandboxValid(template)) throw new SdkDefinitionError("PROVIDER_SANDBOX_INVALID", at)
    return template
}
