import { installed } from "@/modules/plugin-registry"
import type { WorkflowOriginView } from "@/modules/types"

/** The words of the origin section that are the app's own. */
export interface OriginWords {
    readonly title: string
    readonly templateLabel: string
    readonly packageLabel: string
    readonly versionLabel: string
    readonly versionText: (version: number) => string
    /** The one sentence: this graph is the package's, a change comes as a new version. */
    readonly note: string
}

/** What the workflow says of where it came from (the API's template facts). */
export interface OriginSource {
    readonly templateId: string | null
    readonly templateName: string | null
    readonly templateVersion: number | null
}

/**
 * Where a workflow's graph came from, in words: the template, the package that ships it, the version, and the one sentence that says the
 * graph is the package's. Null for a workflow with no template.
 */
export const originOf = (source: OriginSource, locale: "vi" | "en", words: OriginWords): WorkflowOriginView | null => {
    if (source.templateId === null) return null
    const template = installed.templates.find((one) => one.id === source.templateId)
    const plugin = template === undefined ? undefined : installed.plugins.find((one) => one.modules.includes(template.moduleKey))
    const name = template?.name[locale] ?? source.templateName ?? ""
    return {
        title: words.title,
        rows: [
            ...(name === "" ? [] : [{ id: "template", label: words.templateLabel, value: name }]),
            ...(plugin === undefined ? [] : [{ id: "package", label: words.packageLabel, value: plugin.label[locale] }]),
            ...(source.templateVersion === null
                ? []
                : [{ id: "version", label: words.versionLabel, value: words.versionText(source.templateVersion) }]),
        ],
        note: words.note,
    }
}
