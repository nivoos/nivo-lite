import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { parse } from "yaml"
import { WorkspaceSeedError, WorkspaceSeedErrorCode } from "@modules/domain/workspace-seed"
import { SEED_GIT, type ReviewSeed, type SeedGitPort } from "@modules/integrations/seed"
import { GitSeedStandardTargets } from "./git-seed-standard-targets.adapter"

const VALUE = "credential-value-must-never-leak"

/** The git layer opening one working tree (or refusing the folder), and the tree it opens. */
const build = async (tree: ReviewSeed | null) => {
    const git = mock<SeedGitPort>()
    git.review.mockResolvedValue(
        tree === null ? { ok: false, cause: `not a git tree ${VALUE}` } : { ok: true, value: tree },
    )
    const moduleRef = await Test.createTestingModule({
        providers: [GitSeedStandardTargets, { provide: SEED_GIT, useValue: git }],
    }).compile()
    return { targets: moduleRef.get(GitSeedStandardTargets), git }
}

/** A tree over a map of files, that records what it was asked to seal. */
const treeOf = (files: Map<string, string>, sealed: Array<string> = []): ReviewSeed => ({
    readText: (path) => files.get(path) ?? null,
    writeText: (path, text) => (files.get(path) === text ? false : Boolean(files.set(path, text))),
    sealText: (path, plaintext) => Boolean(sealed.push(`${path}\n${plaintext}`)),
})

describe("GitSeedStandardTargets", () => {
    it("opens the tree at the path and passes reads and writes through", async () => {
        const t = await build(treeOf(new Map([["seed.json", "{}"]])))

        const target = await t.targets.open("D:/Repositories/x-seed-standard")

        expect(t.git.review).toHaveBeenCalledWith("D:/Repositories/x-seed-standard")
        expect(await target.readText("seed.json")).toBe("{}")
        expect(await target.readText("absent")).toBeNull()
        expect(await target.writeText("seed.json", "{}")).toBe(false)
        expect(await target.writeText("seed.json", '{"a":1}')).toBe(true)
    })

    it("seals the members as accounts.<key>.<member> YAML to the asked file only, through the tree's seal", async () => {
        const sealed: Array<string> = []
        const t = await build(treeOf(new Map(), sealed))
        const target = await t.targets.open("/tree")

        expect(await target.seal("secrets.dev.enc.yaml", { "zalo-a": { credential: VALUE } })).toBe(true)

        expect(sealed).toHaveLength(1)
        const [path, ...yaml] = (sealed[0] ?? "").split("\n")
        expect(path).toBe("secrets.dev.enc.yaml")
        expect(parse(yaml.join("\n"))).toEqual({ accounts: { "zalo-a": { credential: VALUE } } })
    })

    it("refuses a folder that is not a tree, with a typed error that carries no value", async () => {
        const t = await build(null)

        const refusal = await t.targets.open("/nowhere").catch((cause: unknown) => cause)

        expect(refusal).toBeInstanceOf(WorkspaceSeedError)
        expect(refusal).toMatchObject({ code: WorkspaceSeedErrorCode.InputInvalid, params: { field: "to" } })
        expect(JSON.stringify(refusal)).not.toContain(VALUE)
    })

    it("refuses a failed seal with a typed error that carries no value", async () => {
        const failing = treeOf(new Map())
        jest.spyOn(failing, "sealText").mockImplementation(() => {
            throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.InputInvalid, params: { field: VALUE } })
        })
        const t = await build(failing)
        const target = await t.targets.open("/tree")

        const refusal = await target
            .seal("secrets.dev.enc.yaml", { a: { credential: VALUE } })
            .catch((cause: unknown) => cause)

        expect(refusal).toBeInstanceOf(WorkspaceSeedError)
        expect(refusal).toMatchObject({ code: WorkspaceSeedErrorCode.InputInvalid, params: { field: "seal" } })
        expect(JSON.stringify(refusal)).not.toContain(VALUE)
    })
})
