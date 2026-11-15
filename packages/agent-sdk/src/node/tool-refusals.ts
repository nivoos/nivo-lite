import { SdkDefinitionError, type DefinitionErrorCode } from "../block/definition-error"
import type { RefusalDeclarations } from "./effect.types"

/** What a declaration of refusals is refused for at module load (a `DefinitionErrorCode` each, thrown by `defineTool` and `defineEffect`). */
export type RefusalProblemCode = Extract<
    DefinitionErrorCode,
    | "TOOL_REFUSAL_CODE_MALFORMED"
    | "TOOL_FINAL_REFUSAL_UNKNOWN"
    | "TOOL_FINAL_REFUSAL_ON_READ"
    | "TOOL_FINAL_REFUSAL_RESERVED"
>

/** One problem of a refusal declaration and the code it is at (`<id>:<code>`). */
export interface RefusalProblem {
    /** The kind of problem, from a closed list. */
    readonly code: RefusalProblemCode
    /** The tool or effect id and the refusal code, `<id>:<code>`. */
    readonly at: string
}

/** A refusal code: lower snake case, as the engine's own (`customer_opted_out`, `already_exists`). */
const REFUSAL_CODE = /^[a-z][a-z0-9_]{0,63}$/u

/** The codes the ENGINE answers itself, so no tool declares or finals them: a person's decline of the approval a call asked for. */
const ENGINE_CODES: ReadonlySet<string> = new Set(["declined"])

/**
 * The problems of the refusals a tool or an effect declares, the same checks the engine's native tool specs hold (E-FIX12 rule A-5):
 * a code that is not lower snake case; a final refusal that is not one of the call's own `refusals`; a final refusal on a call that does
 * not write (`writes` false: a read is never a failed act); a refusal code the engine answers itself (`declined`) declared as the call's.
 * Pure: reads the declaration only.
 */
export const refusalProblemsOf = (id: string, declared: RefusalDeclarations, writes: boolean): ReadonlyArray<RefusalProblem> => {
    const own = declared.refusals ?? []
    const finals = declared.finalRefusals ?? []
    const at = (code: string): string => `${id}:${code}`
    return [
        ...[...own, ...finals]
            .filter((code) => !REFUSAL_CODE.test(code))
            .map((code): RefusalProblem => ({ code: "TOOL_REFUSAL_CODE_MALFORMED", at: at(code) })),
        ...[...own, ...finals]
            .filter((code) => ENGINE_CODES.has(code))
            .map((code): RefusalProblem => ({ code: "TOOL_FINAL_REFUSAL_RESERVED", at: at(code) })),
        ...finals
            .filter((code) => !own.includes(code))
            .map((code): RefusalProblem => ({ code: "TOOL_FINAL_REFUSAL_UNKNOWN", at: at(code) })),
        ...(writes ? [] : finals.map((code): RefusalProblem => ({ code: "TOOL_FINAL_REFUSAL_ON_READ", at: at(code) }))),
    ]
}

/** Throws the first problem of a refusal declaration as `SdkDefinitionError` (at module load); nothing for a sound one. */
export const assertRefusals = (id: string, declared: RefusalDeclarations, writes: boolean): void => {
    const [first] = refusalProblemsOf(id, declared, writes)
    if (first !== undefined) throw new SdkDefinitionError(first.code, first.at)
}

/**
 * The refusals a definition (a plugin's tool or effect as the installation holds it) declares FINAL: the ONE reader of the declaration,
 * read by the engine from the installed definition exactly as it reads a native tool's spec. Empty for a definition that declares none.
 */
export const finalRefusalsOf = (definition: RefusalDeclarations): ReadonlyArray<string> => definition.finalRefusals ?? []
