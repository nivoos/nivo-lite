import { MODULE_SERVERS } from "../module-servers"
import { knowledgeIdeasOf } from "./knowledge-ideas"
import * as vi from "./messages/vi.json"

/** Every idea name that has words in the catalogue. */
const NAMES = Object.keys(vi)
    .filter((key) => key.endsWith(".topic"))
    .map((key) => key.slice("ideas.".length, -".topic".length))

const declared = MODULE_SERVERS.flatMap((server) =>
    (server.template.knowledgeIdeas ?? []).map((idea) => ({ module: server.key, idea })),
)

describe("the knowledge ideas the modules declare", () => {
    it("words every declared idea in both product languages", () => {
        expect(declared.length).toBeGreaterThan(0)
        for (const { idea } of declared) {
            for (const words of [idea.topic, idea.hint]) {
                expect(words.vi.trim()).not.toBe("")
                expect(words.en.trim()).not.toBe("")
            }
        }
    })

    it("declares each idea once in a module", () => {
        for (const server of MODULE_SERVERS) {
            const keys = (server.template.knowledgeIdeas ?? []).map((idea) => idea.key)
            expect(new Set(keys).size).toBe(keys.length)
        }
    })

    it("leaves no worded idea that no module declares", () => {
        const used = new Set(declared.map(({ idea }) => idea.key))
        expect(NAMES.filter((name) => !used.has(name))).toEqual([])
    })

    it("gives an idea the modules share one wording", () => {
        const wordings = (key: string) =>
            declared.filter(({ idea }) => idea.key === key).map(({ idea }) => JSON.stringify([idea.topic, idea.hint]))
        const shared = [...new Set(declared.map(({ idea }) => idea.key))].filter((key) => wordings(key).length > 1)
        expect(shared).toContain("about")
        for (const key of shared) expect(new Set(wordings(key)).size).toBe(1)
    })

    it("carries what narrows an idea: the business types it fits and that it fits every agent", () => {
        const [policies, voice, plain] = knowledgeIdeasOf(["policies", "brand_voice", "faq"])
        expect(policies?.businessTypes).toEqual(["retail", "services", "clinic", "education"])
        expect(voice?.general).toBe(true)
        expect(plain?.businessTypes).toBeUndefined()
        expect(plain?.general).toBeUndefined()
    })
})
