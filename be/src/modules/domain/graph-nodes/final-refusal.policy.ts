import { finalRefusalsOf, type RefusalDeclarations } from "@nivo-lite/agent-sdk/node"
import { finalRefusalBySpec } from "@modules/domain/tool-specs"

/**
 * THE ONE READER of "this refusal is FINAL for the subject" (E-FIX12 rule A-5; the SDK declaration of plugin tools and effects): a business
 * answer, never a stop. The tool declares it where it lives: a core tool in its spec (`finalRefusals`), a plugin's tool or effect on its
 * own definition (`finalRefusals` of `defineTool` / `defineEffect`, the installation's definition handed here as `defined`). Both
 * declarations mean the same, so this answers from whichever the call's tool has; an id with neither declares none (never guessed:
 * an undeclared refusal of a write outside is a stop). The boot gate (`tool-declarations.policy.ts`) refuses a plugin's definition that
 * also declares finals over a core spec, so the two sources never disagree.
 */
export const finalRefusalOf = (tool: string, refusal: string, defined?: RefusalDeclarations): boolean =>
    finalRefusalBySpec(tool, refusal) || (defined !== undefined && finalRefusalsOf(defined).includes(refusal))
