import type { ModuleCopy } from "@/modules/catalog"
import { ideasFor, ideasOf, relevanceOf, wordsOfIdea } from "./knowledge-ideas"

const words = (text: string) => ({ vi: `${text} vi`, en: `${text} en` })

type Declared = ModuleCopy["knowledgeIdeas"][number]

const declared = (key: string, over: Partial<Declared> = {}): Declared => ({
    key,
    topic: words(`topic ${key}`),
    hint: words(`hint ${key}`),
    businessTypes: [],
    general: false,
    ...over,
})

/** A catalogue row of an invented module: no package of the lane declares these keys. */
const moduleOf = (key: string, knowledgeIdeas: ReadonlyArray<Declared>): Pick<ModuleCopy, "key" | "knowledgeIdeas"> => ({
    key,
    knowledgeIdeas: [...knowledgeIdeas],
})

const CATALOGUE = [
    moduleOf("alpha", [declared("shared"), declared("only_alpha"), declared("voice", { general: true })]),
    moduleOf("beta", [declared("shared"), declared("only_beta", { businessTypes: ["clinic"] }), declared("voice", { general: true })]),
    moduleOf("gamma", []),
]

describe("the knowledge ideas the catalogue serves", () => {
    it("merges the ideas of the modules by key and lists every module that declares one", () => {
        const ideas = ideasOf(CATALOGUE)
        expect(ideas.map((idea) => idea.key)).toEqual(["shared", "only_alpha", "voice", "only_beta"])
        expect(ideas.find((idea) => idea.key === "shared")?.modules).toEqual(["alpha", "beta"])
        expect(ideasOf([moduleOf("gamma", [])])).toEqual([])
    })

    it("words an idea in the reader language", () => {
        const [shared] = ideasOf(CATALOGUE)
        expect(wordsOfIdea(shared!, "en")).toEqual({ topic: "topic shared en", hint: "hint shared en" })
        expect(wordsOfIdea(shared!, "vi")).toEqual({ topic: "topic shared vi", hint: "hint shared vi" })
    })

    it("offers only what an installed module declares, so a module that declares nothing offers nothing", () => {
        const ideas = ideasOf(CATALOGUE)
        expect(ideasFor(ideas, ["gamma"], null)).toEqual([])
        expect(ideasFor(ideas, ["beta"], null).map((idea) => idea.key).sort()).toEqual(["only_beta", "shared", "voice"])
    })

    it("narrows by the business type when the idea names some and the workspace has one", () => {
        const ideas = ideasOf(CATALOGUE)
        expect(ideasFor(ideas, ["beta"], "retail").map((idea) => idea.key)).not.toContain("only_beta")
        expect(ideasFor(ideas, ["beta"], "clinic").map((idea) => idea.key)).toContain("only_beta")
        expect(ideasFor(ideas, ["beta"], null).map((idea) => idea.key)).toContain("only_beta")
    })

    it("ranks the ideas for more installed agents first and an idea for every agent after the specific ones", () => {
        const ideas = ideasOf(CATALOGUE)
        const installed = ["alpha", "beta"]
        expect(ideasFor(ideas, installed, null).map((idea) => idea.key)).toEqual(["shared", "only_alpha", "only_beta", "voice"])
        const voice = ideas.find((idea) => idea.key === "voice")!
        expect(relevanceOf(voice, installed)).toBe(0.5)
    })
})
