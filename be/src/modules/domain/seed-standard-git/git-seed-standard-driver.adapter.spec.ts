import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { WorkspaceSeedError, WorkspaceSeedErrorCode, type SeedStandardRef } from "@modules/domain/workspace-seed"
import { SEED_GIT, type SeedGitPort, type SeedSealedRead } from "@modules/integrations/seed"
import { GitSeedStandardDriver } from "./git-seed-standard-driver.adapter"

const REF: SeedStandardRef = {
    name: "blocks-core-seed-standard",
    repository: "https://example.invalid/blocks-core-seed-standard",
    commit: "9865ee72a0dca3b61eb55a98d1a459f724d1963b",
    force: false,
    forceKinds: [],
}

/** The git layer over one pinned repository: its files by path and its sealed files by path (or why they gave no text). */
const build = async (sealed: Readonly<Record<string, SeedSealedRead>>) => {
    const git = mock<SeedGitPort>()
    git.pin.mockResolvedValue({
        ok: true,
        value: {
            readText: (path) => (path === "seed.json" ? "{}" : null),
            sealedText: (path) => sealed[path] ?? { opened: false, reason: "file_missing" },
        },
    })
    const moduleRef = await Test.createTestingModule({
        providers: [GitSeedStandardDriver, { provide: SEED_GIT, useValue: git }],
    }).compile()
    return { driver: moduleRef.get(GitSeedStandardDriver), git }
}

describe("GitSeedStandardDriver", () => {
    it("passes the ref through to the pin: repository, commit and name", async () => {
        const t = await build({})

        await t.driver.checkout(REF)

        expect(t.git.pin).toHaveBeenCalledWith({ repository: REF.repository, commit: REF.commit, name: REF.name })
    })

    it("reads a file of the pinned commit, and null for a file it does not hold", async () => {
        const t = await build({})

        const checkout = await t.driver.checkout(REF)

        expect(await checkout.readText("seed.json")).toBe("{}")
        expect(await checkout.readText("absent.md")).toBeNull()
    })

    it("reads the opened sealed file as accounts.<key>.<member>", async () => {
        const t = await build({
            "secrets.dev.enc.yaml": { opened: true, text: "accounts:\n  zalo-a:\n    credential: c\n" },
        })

        const checkout = await t.driver.checkout(REF)

        expect(await checkout.sealedOf("secrets.dev.enc.yaml")).toEqual({
            opened: true,
            accounts: { "zalo-a": { credential: "c" } },
        })
    })

    it("answers the typed reason a sealed file gave no text with, and names a file that is no mapping", async () => {
        const t = await build({
            "list.enc.yaml": { opened: true, text: "- x\n" },
            "closed.enc.yaml": { opened: false, reason: "not_openable" },
        })

        const checkout = await t.driver.checkout(REF)

        expect(await checkout.sealedOf("list.enc.yaml")).toEqual({ opened: false, reason: "not_a_mapping" })
        expect(await checkout.sealedOf("closed.enc.yaml")).toEqual({ opened: false, reason: "not_openable" })
        expect(await checkout.sealedOf("absent.enc.yaml")).toEqual({ opened: false, reason: "file_missing" })
    })

    it("refuses a repository the pin cannot reach as WORKSPACE_SEED_PIN_UNVERIFIED, carrying the name only", async () => {
        const t = await build({})
        t.git.pin.mockResolvedValue({
            ok: false,
            cause: "clone of https://user:credential-value-must-never-leak@host failed",
        })

        const refusal = await t.driver.checkout(REF).catch((cause: unknown) => cause)

        expect(refusal).toBeInstanceOf(WorkspaceSeedError)
        expect(refusal).toMatchObject({ code: WorkspaceSeedErrorCode.PinUnverified, params: { name: REF.name } })
        expect(JSON.stringify(refusal)).not.toContain("credential-value-must-never-leak")
    })
})
