import { Injectable } from "@nestjs/common"
import type { DriverAdapter, OpenContext } from "@starci/seed"
import type { PinnedRepository } from "@starci/seed/git"
import { attempt, attemptAsync } from "@modules/platform/primitives"
import { InjectSeedGitLibrary, InjectSeedOptions } from "./seed.decorators"
import type { DataSeedOptions } from "./seed.options"
import type {
    BackupDriverRequest,
    SeedGitLibrary,
    SeedGitPort,
    SeedPinOutcome,
    SeedPinRequest,
    SeedReviewOutcome,
    SeedSealedRead,
} from "./seed.port"

@Injectable()
/**
 * The git layer of the data standard over `@starci/seed/git`: a repository is fetched into a cache outside every app tree and read AT ITS
 * PINNED COMMIT; its sealed file is opened in memory with the environment's identity, never written, logged or put in an error.
 */
export class SeedGitService implements SeedGitPort {
    constructor(
        @InjectSeedOptions() private readonly options: DataSeedOptions,
        @InjectSeedGitLibrary() private readonly library: SeedGitLibrary,
    ) {}

    /** Fetches the repository the request names and answers it at the pinned commit. */
    pin(request: SeedPinRequest): Promise<SeedPinOutcome> {
        return attemptAsync(() =>
            Promise.resolve(
                this.library.pinRepository({ ...request, cache: this.options.cache, env: this.options.gitEnv }),
            ),
        ).then((pinned): SeedPinOutcome =>
            pinned.ok
                ? {
                      ok: true,
                      value: {
                          readText: (path) => pinned.value.readText(path),
                          sealedText: (path) => this.sealedOf(pinned.value, path),
                      },
                  }
                : pinned,
        )
    }

    /** Opens the working tree at a path for review writes. */
    review(path: string): Promise<SeedReviewOutcome> {
        return attemptAsync(() =>
            Promise.resolve(this.library.openReviewTree(path, { env: this.options.gitEnv })),
        ).then((opened): SeedReviewOutcome =>
            opened.ok
                ? {
                      ok: true,
                      value: {
                          readText: (file) => opened.value.readText(file),
                          writeText: (file, text) => opened.value.writeText(file, text),
                          sealText: (file, plaintext) => opened.value.seal(file, Buffer.from(plaintext, "utf8")),
                      },
                  }
                : opened,
        )
    }

    /** The git driver of one backup copy repository, with the integration's git environment. */
    backupDriver(request: BackupDriverRequest): DriverAdapter {
        return this.library.createGitDriver({
            id: request.id,
            checkout: request.checkout,
            ...(request.remote === undefined ? {} : { remote: request.remote }),
            env: this.options.gitEnv,
        })
    }

    /** The identity of this environment as the handle a copy is opened with; an absent identity is an empty handle, so a verify cannot open a copy (never a silent pass). */
    openContext(): OpenContext {
        const key = this.options.identity?.reveal()
        return { identity: { kind: "age-identity", env: key === undefined ? {} : { SOPS_AGE_KEY: key } } }
    }

    /** The sealed file opened in memory, or the fixed reason it gave none. */
    private sealedOf(pinned: PinnedRepository, path: string): SeedSealedRead {
        const identity = this.options.identity?.reveal()
        if (identity === undefined) return { opened: false, reason: "identity_missing" }
        const opened = attempt(() =>
            pinned.openSealed(path, { identity: { kind: "age-identity", env: { SOPS_AGE_KEY: identity } } }),
        )
        if (!opened.ok) return { opened: false, reason: "not_openable" }
        return opened.value === null
            ? { opened: false, reason: "file_missing" }
            : { opened: true, text: opened.value.toString("utf8") }
    }
}
