import type { ModuleCopy } from "@/modules/catalog"

/** The reader language of a suggestion's words. */
export type IdeaLocale = "vi" | "en"

/** A suggestion to add something to the knowledge, never a requirement: what the installed modules declare, merged by key. */
export interface DocumentIdea {
    readonly key: string
    /** The title, in both languages. */
    readonly topic: { readonly vi: string; readonly en: string }
    /** What to write, in both languages. */
    readonly hint: { readonly vi: string; readonly en: string }
    /** The modules that declare it: it shows when at least one is installed. */
    readonly modules: ReadonlyArray<string>
    /** Business types it fits; empty = any. */
    readonly businessTypes: ReadonlyArray<string>
    /** It fits every agent: it ranks after the specific ones. */
    readonly general: boolean
}

/** What one idea says in the reader language. */
export interface IdeaWords {
    readonly topic: string
    readonly hint: string
}

/**
 * The suggestions the modules of the catalogue declare (`knowledgeIdeas`), one per key: the same key declared by several modules is one
 * suggestion that lists them all. The host holds no suggestion of its own.
 */
export const ideasOf = (catalogue: ReadonlyArray<Pick<ModuleCopy, "key" | "knowledgeIdeas">>): ReadonlyArray<DocumentIdea> => {
    const byKey = new Map<string, DocumentIdea>()
    for (const module of catalogue) {
        for (const declared of module.knowledgeIdeas) {
            const known = byKey.get(declared.key)
            byKey.set(declared.key, {
                key: declared.key,
                topic: declared.topic,
                hint: declared.hint,
                modules: [...(known?.modules ?? []), module.key],
                businessTypes: declared.businessTypes,
                general: declared.general,
            })
        }
    }
    return [...byKey.values()]
}

/** The words of an idea in the reader language. */
export const wordsOfIdea = (idea: DocumentIdea, locale: IdeaLocale): IdeaWords => ({
    topic: locale === "en" ? idea.topic.en : idea.topic.vi,
    hint: locale === "en" ? idea.hint.en : idea.hint.vi,
})

/** How many of the installed agents an idea is for; a suggestion for every agent counts once, so it ranks after the specific ones. */
export const relevanceOf = (idea: DocumentIdea, installed: ReadonlyArray<string>): number =>
    idea.general ? 0.5 : idea.modules.filter((module) => installed.includes(module)).length

/** The suggestions that fit the installed modules and the business type of the workspace, the most relevant to the installed agents first. */
export const ideasFor = (
    ideas: ReadonlyArray<DocumentIdea>,
    installed: ReadonlyArray<string>,
    businessType: string | null,
): ReadonlyArray<DocumentIdea> =>
    ideas
        .filter(
            (one) =>
                one.modules.some((module) => installed.includes(module)) &&
                (one.businessTypes.length === 0 || businessType === null || one.businessTypes.includes(businessType)),
        )
        .sort((a, b) => relevanceOf(b, installed) - relevanceOf(a, installed))
