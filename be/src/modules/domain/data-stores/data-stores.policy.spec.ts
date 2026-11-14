import { Test } from "@nestjs/testing"
import {
    fullKeyOf,
    isJsonRecord,
    knowledgeKeyOf,
    knowledgeKeyParts,
    mediaOf,
    recordObjectOf,
    schemaOf,
} from "./data-stores.policy"

const SUBJECT = Symbol("data-stores.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [
            {
                provide: SUBJECT,
                useValue: {
                    fullKeyOf,
                    isJsonRecord,
                    knowledgeKeyOf,
                    knowledgeKeyParts,
                    mediaOf,
                    recordObjectOf,
                    schemaOf,
                },
            },
        ],
    }).compile()
    return moduleRef.get<typeof import("./data-stores.policy")>(SUBJECT)
}

describe("the knowledge key", () => {
    it("holds no slash in its origin part, and reads back to the origin and the title", async () => {
        const subject = await build()
        const key = subject.knowledgeKeyOf("seed:nivo/x", "a/b title")

        expect(key).toBe("seed%3Anivo%2Fx/a/b title")
        expect(subject.knowledgeKeyParts(key)).toEqual({ origin: "seed:nivo/x", title: "a/b title" })
    })

    it("is no key when it has no slash, no origin, no title, or an origin that is not percent-encoded text", async () => {
        const subject = await build()

        expect(subject.knowledgeKeyParts("no-slash")).toBeNull()
        expect(subject.knowledgeKeyParts("/title")).toBeNull()
        expect(subject.knowledgeKeyParts("origin/")).toBeNull()
        expect(subject.knowledgeKeyParts("%E0%A4%A/title")).toBeNull()
    })
})

describe("the records of the data standard", () => {
    it("names the schema of a set by its form", async () => {
        const subject = await build()

        expect(subject.schemaOf("knowledge", "record")).toBe("nivo-seed-standard/knowledge@1")
        expect(subject.schemaOf("record-files", "blob")).toBe("blob@1")
    })

    it("takes a JSON object as a record and nothing else: not null, not an array, not a scalar", async () => {
        const subject = await build()

        expect(subject.recordObjectOf({ a: 1 })).toEqual({ a: 1 })
        expect(subject.recordObjectOf([1])).toBeNull()
        expect(subject.recordObjectOf(null)).toBeNull()
        expect(subject.recordObjectOf("text")).toBeNull()
        expect(subject.isJsonRecord({})).toBe(true)
    })
})

describe("the objects of a workspace", () => {
    it("keys an object by its workspace first", async () => {
        const subject = await build()

        expect(subject.fullKeyOf("ws-1", "a/b")).toBe("ws-1/a/b")
    })

    it("exports an object with the content type the store recorded, else the default", async () => {
        const subject = await build()

        expect(subject.mediaOf("image/png")).toBe("image/png")
        expect(subject.mediaOf("")).toBe("application/octet-stream")
    })
})
