import type { ModuleKnowledgeIdea } from "@nivo-lite/agent-sdk/module"
import { catalogueCopyOf } from "../../agent/catalogue-copy"
import * as en from "./messages/en.json"
import * as vi from "./messages/vi.json"

/** A key of the knowledge ideas' own message catalogue. */
type IdeaCopyKey = Exclude<keyof typeof vi, "default">

/** The name of a knowledge idea: the key its words (`ideas.<name>.topic` and `.hint`) are stored under. */
export type KnowledgeIdeaName = IdeaCopyKey extends infer Key
    ? Key extends `ideas.${infer Name}.topic`
        ? Name
        : never
    : never

/** The words of the knowledge ideas, read from their own message catalogue. */
const IDEA_COPY = catalogueCopyOf<IdeaCopyKey>(vi, en)

/** What narrows an idea beyond the module that declares it: the business types it fits, and whether it fits every agent. */
interface IdeaFit {
    readonly businessTypes?: ReadonlyArray<string>
    readonly general?: true
}

/** The ideas that do not fit every shop or that fit every agent; the other ideas have no entry. */
const FITS: Readonly<Partial<Record<KnowledgeIdeaName, IdeaFit>>> = {
    policies: { businessTypes: ["retail", "services", "clinic", "education"] },
    brand_voice: { general: true },
}

/**
 * The knowledge ideas a module declares (`knowledgeIdeas` of its template), by name, in the order given: one copy of each idea's words,
 * shared by the modules that suggest it (the same name declared by two modules is one suggestion the host shows once).
 */
export const knowledgeIdeasOf = (names: ReadonlyArray<KnowledgeIdeaName>): ReadonlyArray<ModuleKnowledgeIdea> =>
    names.map((name) => ({
        key: name,
        topic: IDEA_COPY.text(`ideas.${name}.topic`),
        hint: IDEA_COPY.text(`ideas.${name}.hint`),
        ...FITS[name],
    }))
