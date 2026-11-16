import { Injectable } from "@nestjs/common"
import {
    WorkspaceSeedError,
    WorkspaceSeedErrorCode,
    type SeedStandardCheckout,
    type SeedStandardDriver,
    type SeedStandardRef,
} from "@modules/domain/workspace-seed"
import { InjectSeedGit, type SeedGitPort } from "@modules/integrations/seed"
import { sealedValuesOf } from "./seed-standard-git.policy"

@Injectable()
/**
 * The seed standard driver over the data standard's git layer: a `-seed-standard` repository is fetched into a cache outside every app tree and
 * read AT ITS PINNED COMMIT; its sealed file is opened in memory with the environment's identity and parsed, never written, logged or put in an error.
 * A repository that cannot be reached or does not hold the commit is `WORKSPACE_SEED_PIN_UNVERIFIED`; a sealed file that cannot be opened
 * (no identity, absent, wrong key, not a mapping) answers `{ opened: false, reason }` with a fixed reason word.
 */
export class GitSeedStandardDriver implements SeedStandardDriver {
    constructor(@InjectSeedGit() private readonly git: SeedGitPort) {}

    /** Fetches the repository the ref names and answers it at the pinned commit. */
    async checkout(ref: SeedStandardRef): Promise<SeedStandardCheckout> {
        const pinned = await this.git.pin({ repository: ref.repository, commit: ref.commit, name: ref.name })
        if (!pinned.ok) {
            throw new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.PinUnverified, params: { name: ref.name } })
        }
        const repository = pinned.value
        return {
            readText: (path) => Promise.resolve(repository.readText(path)),
            sealedOf: (path) => Promise.resolve(sealedValuesOf(repository.sealedText(path))),
        }
    }
}
