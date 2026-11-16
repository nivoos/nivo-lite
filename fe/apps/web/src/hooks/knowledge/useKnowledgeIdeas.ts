"use client"

import { useMemo } from "react"
import { useLocale } from "next-intl"
import { useModuleCatalog } from "@/hooks/moduleCatalog"
import { ideasFor, ideasOf, topicsOf, wordsOfIdea } from "@/modules/documents"
import type { IdeaDecision } from "@/modules/types"
import { useKnowledgeSources } from "./useKnowledgeSources"
import { useKnowledgeSuggestions } from "./useKnowledgeSuggestions"
import { useModuleInstallations } from "./useModuleInstallations"
import { useWorkspaceMember } from "./useWorkspaceMember"

/** One idea: its key and its words in the reader language. */
interface IdeaView {
    readonly key: string
    readonly topic: string
    readonly hint: string
    readonly state?: IdeaDecision
}

/** What the suggestions block draws. */
interface KnowledgeIdeas {
    /** Owners and managers see the ideas; everyone else sees nothing. */
    readonly canWrite: boolean
    readonly open: ReadonlyArray<IdeaView>
    readonly skipped: ReadonlyArray<IdeaView>
    readonly isLoading: boolean
}

/**
 * The ideas of documents worth adding for the workspace: the ones that fit its installed agents and business type, minus the
 * ones the owner decided about and the ones already covered by a document topic.
 */
export const useKnowledgeIdeas = (): KnowledgeIdeas => {
    const locale = useLocale() === "en" ? "en" : "vi"
    const catalog = useModuleCatalog()
    const member = useWorkspaceMember()
    const { sources, isLoading: sourcesLoading } = useKnowledgeSources()
    const { installations, isLoading: installationsLoading } = useModuleInstallations()
    const { context, isLoading: contextLoading } = useKnowledgeSuggestions(member.canWrite)
    const isLoading =
        member.isLoading ||
        sourcesLoading ||
        catalog.read.isLoading ||
        installationsLoading ||
        (member.canWrite && contextLoading) ||
        sources === undefined ||
        installations === undefined
    const { open, skipped } = useMemo(() => {
        if (!member.canWrite || sources === undefined || installations === undefined) return { open: [], skipped: [] }
        const decided = context?.states ?? new Map<string, IdeaDecision>()
        const used = new Set(topicsOf(sources).map((topic) => topic.toLowerCase()))
        const installed = installations.map((one) => one.moduleKey)
        const fitting = ideasFor(ideasOf(catalog.list), installed, context === undefined ? null : context.businessType)
        return {
            open: fitting.flatMap((one) => {
                const words = wordsOfIdea(one, locale)
                return decided.has(one.key) || used.has(words.topic.toLowerCase()) ? [] : [{ key: one.key, ...words }]
            }),
            skipped: fitting.flatMap((one) => {
                const state = decided.get(one.key)
                return state === undefined ? [] : [{ key: one.key, ...wordsOfIdea(one, locale), state }]
            }),
        }
    }, [member.canWrite, context, sources, installations, catalog.list, locale])
    return { canWrite: member.canWrite, open, skipped, isLoading }
}
