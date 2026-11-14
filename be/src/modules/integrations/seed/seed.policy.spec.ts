import { tmpdir } from "node:os"
import { join } from "node:path"
import { Test } from "@nestjs/testing"
import { seedOptionsOf } from "./seed.policy"

const SUBJECT = Symbol("seed.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { seedOptionsOf } }],
    }).compile()
    return moduleRef.get<typeof import("./seed.policy")>(SUBJECT)
}

describe("the settings of the data standard's git layer", () => {
    it("works without any key: the cache is a folder outside every code repository, there is no identity and no git author", async () => {
        const subject = await build()

        const options = subject.seedOptionsOf({
            cache: undefined,
            identity: undefined,
            git: [{ key: "GIT_AUTHOR_NAME", value: undefined }],
        })

        expect(options).toEqual({ cache: join(tmpdir(), "starci-seed-standards"), identity: undefined, gitEnv: {} })
    })

    it("reads the cache, the identity (kept as a secret) and only the git author keys that are declared", async () => {
        const subject = await build()

        const options = subject.seedOptionsOf({
            cache: "/cache/seeds",
            identity: "AGE-SECRET-KEY-FAKE",
            git: [
                { key: "GIT_AUTHOR_NAME", value: "seed" },
                { key: "GIT_AUTHOR_EMAIL", value: undefined },
                { key: "GIT_COMMITTER_EMAIL", value: "seed@example.test" },
            ],
        })

        expect(options.cache).toBe("/cache/seeds")
        expect(options.identity?.reveal()).toBe("AGE-SECRET-KEY-FAKE")
        expect(options.gitEnv).toEqual({ GIT_AUTHOR_NAME: "seed", GIT_COMMITTER_EMAIL: "seed@example.test" })
        expect(JSON.stringify(options)).not.toContain("AGE-SECRET-KEY-FAKE")
    })
})
