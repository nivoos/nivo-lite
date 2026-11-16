import { graphSpecSchema, type GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { latestTemplateVersion } from "@nivo-lite/agent-sdk/template"
import { INSTALLED } from "@modules/domain/installed-plugins"

/**
 * The graph installing a module's template agent publishes as its primary workflow (read as the seed reads a graph file), or null when
 * the module has no single primary template. The roster seed and the set seed install an agent with exactly this graph.
 */
export const primaryGraphOf = (moduleKey: string): GraphSpec | null => {
    const primaries = INSTALLED.templatesOf(moduleKey).filter((template) => template.primary)
    const [only] = primaries
    if (only === undefined || primaries.length > 1) return null
    const parsed = graphSpecSchema.safeParse(JSON.parse(JSON.stringify(latestTemplateVersion(only).graph)))
    return parsed.success ? parsed.data : null
}
