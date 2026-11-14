import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { DataRefusal } from "@starci/seed"
import type { PinnedRepository, ReviewTree } from "@starci/seed/git"
import { Secret } from "@modules/platform/config"
import { SEED_GIT_LIBRARY, SEED_OPTIONS } from "./seed.decorators"
import type { PinnedSeed, ReviewSeed, SeedGitLibrary } from "./seed.port"
import { SeedGitService } from "./seed-git.service"

const IDENTITY = "AGE-SECRET-KEY-FAKE-IDENTITY"
const VALUE = "credential-value-must-never-leak"
const REQUEST = {
    repository: "https://example.invalid/blocks-core-seed-standard",
    commit: "9865ee72a0dca3b61eb55a98d1a459f724d1963b",
    name: "blocks-core-seed-standard",
}

/** What a call of the library's `openSealed` was given: the file and the identity handle. */
interface OpenedFile {
    /** The repository-relative path. */
    readonly path: string
    /** The identity the sealed file was opened with. */
    readonly key: string
}

const build = async (identity: string | null = IDENTITY) => {
    const library = mock<SeedGitLibrary>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            SeedGitService,
            {
                provide: SEED_OPTIONS,
                useValue: {
                    cache: "/cache/outside-the-app",
                    identity: identity === null ? undefined : new Secret(identity),
                    gitEnv: { GIT_AUTHOR_NAME: "seed" },
                },
            },
            { provide: SEED_GIT_LIBRARY, useValue: library },
        ],
    }).compile()
    return { service: moduleRef.get(SeedGitService), library }
}

/** The repository a pin answered, or undefined when it answered a failure. */
const repositoryPinned = async (service: SeedGitService): Promise<PinnedSeed | undefined> => {
    const pinned = await service.pin(REQUEST)
    return pinned.ok ? pinned.value : undefined
}

/** The tree a review answered, or undefined when it answered a failure. */
const treeOpened = async (service: SeedGitService, path: string): Promise<ReviewSeed | undefined> => {
    const opened = await service.review(path)
    return opened.ok ? opened.value : undefined
}

/** A pinned repository over a file and sealed files by path (a refusal stands for a sealed file that does not open); `opened` records every open. */
const repositoryOf = (
    sealed: Readonly<Record<string, string | DataRefusal>>,
    opened: Array<OpenedFile> = [],
): PinnedRepository =>
    mock<PinnedRepository>({
        readText: (path: string) => (path === "seed.json" ? "{}" : null),
        openSealed: (path, context) => {
            opened.push({ path, key: context.identity.env.SOPS_AGE_KEY ?? "" })
            const found = sealed[path]
            if (found instanceof DataRefusal) throw found
            return found === undefined ? null : Buffer.from(found)
        },
    })

describe("SeedGitService: a repository at its pinned commit", () => {
    it("passes the request to the pin with the cache outside the app and the git author, and reads a file of the commit", async () => {
        const t = await build()
        t.library.pinRepository.mockReturnValue(repositoryOf({}))

        const pinned = await repositoryPinned(t.service)

        expect(t.library.pinRepository).toHaveBeenCalledWith({
            ...REQUEST,
            cache: "/cache/outside-the-app",
            env: { GIT_AUTHOR_NAME: "seed" },
        })
        expect(pinned?.readText("seed.json")).toBe("{}")
        expect(pinned?.readText("absent.md")).toBeNull()
    })

    it("answers why a repository could not be pinned, never throwing", async () => {
        const t = await build()
        t.library.pinRepository.mockImplementation(() => {
            throw new DataRefusal("DATA_DRIVER_UNAVAILABLE", "transient", { driver: VALUE })
        })

        const pinned = await t.service.pin(REQUEST)

        expect(pinned.ok).toBe(false)
    })

    it("opens only the asked sealed file, in memory, with the environment's identity", async () => {
        const t = await build()
        const opened: Array<OpenedFile> = []
        t.library.pinRepository.mockReturnValue(repositoryOf({ "secrets.dev.enc.yaml": "accounts: {}\n" }, opened))

        const pinned = await repositoryPinned(t.service)

        expect(pinned?.sealedText("secrets.dev.enc.yaml")).toEqual({ opened: true, text: "accounts: {}\n" })
        expect(opened).toEqual([{ path: "secrets.dev.enc.yaml", key: IDENTITY }])
    })

    it("answers a fixed reason and no value: an absent file and a file that does not open", async () => {
        const t = await build()
        t.library.pinRepository.mockReturnValue(
            repositoryOf({
                "wrong-key.enc.yaml": new DataRefusal("DATA_SEAL_FAILED", "configuration", { driver: VALUE }),
            }),
        )

        const pinned = await repositoryPinned(t.service)
        const answers = [pinned?.sealedText("absent.enc.yaml"), pinned?.sealedText("wrong-key.enc.yaml")]

        expect(answers).toEqual([
            { opened: false, reason: "file_missing" },
            { opened: false, reason: "not_openable" },
        ])
        expect(JSON.stringify(answers)).not.toContain(VALUE)
    })

    it("opens nothing and answers a fixed reason when the environment has no identity", async () => {
        const t = await build(null)
        const opened: Array<OpenedFile> = []
        t.library.pinRepository.mockReturnValue(
            repositoryOf({ "secrets.dev.enc.yaml": `accounts:\n  a:\n    credential: ${VALUE}\n` }, opened),
        )

        const pinned = await repositoryPinned(t.service)
        const answer = pinned?.sealedText("secrets.dev.enc.yaml")

        expect(answer).toEqual({ opened: false, reason: "identity_missing" })
        expect(opened).toEqual([])
    })
})

describe("SeedGitService: a working tree for review", () => {
    it("opens the tree at the path with the git author and passes reads, writes and seals through (the seal takes the text as bytes)", async () => {
        const t = await build()
        const files = new Map<string, string>([["seed.json", "{}"]])
        const sealed: Array<string> = []
        const tree: ReviewTree = {
            readText: (path) => files.get(path) ?? null,
            writeText: (path, text) => (files.get(path) === text ? false : Boolean(files.set(path, text))),
            seal: (path, plaintext) => Boolean(sealed.push(`${path} ${plaintext.toString("utf8")}`)),
        }
        t.library.openReviewTree.mockReturnValue(tree)

        const opened = await treeOpened(t.service, "D:/Repositories/x-seed-standard")

        expect(t.library.openReviewTree).toHaveBeenCalledWith("D:/Repositories/x-seed-standard", {
            env: { GIT_AUTHOR_NAME: "seed" },
        })
        expect(opened?.readText("seed.json")).toBe("{}")
        expect(opened?.writeText("seed.json", "{}")).toBe(false)
        expect(opened?.writeText("seed.json", '{"a":1}')).toBe(true)
        expect(opened?.sealText("secrets.dev.enc.yaml", "accounts: {}")).toBe(true)
        expect(sealed).toEqual(["secrets.dev.enc.yaml accounts: {}"])
    })

    it("answers that a folder is not a tree, never throwing", async () => {
        const t = await build()
        t.library.openReviewTree.mockImplementation(() => {
            throw new DataRefusal("DATA_DRIVER_UNAVAILABLE", "configuration", { driver: VALUE })
        })

        expect((await t.service.review("/nowhere")).ok).toBe(false)
    })
})

describe("SeedGitService: the backup copy repository", () => {
    it("builds the git driver of one repository with the git author, a remote only when there is one", async () => {
        const t = await build()

        t.service.backupDriver({ id: "nivo-lite-seed-backup-dev", checkout: "/c", remote: "https://example.invalid/r" })
        t.service.backupDriver({ id: "nivo-lite-seed-backup-dev", checkout: "/c", remote: undefined })

        expect(t.library.createGitDriver).toHaveBeenNthCalledWith(1, {
            id: "nivo-lite-seed-backup-dev",
            checkout: "/c",
            remote: "https://example.invalid/r",
            env: { GIT_AUTHOR_NAME: "seed" },
        })
        expect(t.library.createGitDriver).toHaveBeenNthCalledWith(2, {
            id: "nivo-lite-seed-backup-dev",
            checkout: "/c",
            env: { GIT_AUTHOR_NAME: "seed" },
        })
    })

    it("hands the verify the identity of this environment, or an empty handle when none is declared (a copy then cannot be opened)", async () => {
        const declared = await build()
        const undeclared = await build(null)

        expect(declared.service.openContext()).toEqual({
            identity: { kind: "age-identity", env: { SOPS_AGE_KEY: IDENTITY } },
        })
        expect(undeclared.service.openContext()).toEqual({ identity: { kind: "age-identity", env: {} } })
    })
})
