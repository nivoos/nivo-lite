import { Injectable } from "@nestjs/common"
import { stringify } from "yaml"
import {
    WorkspaceSeedError,
    WorkspaceSeedErrorCode,
    type SeedStandardTarget,
    type SeedStandardTargets,
} from "@modules/domain/workspace-seed"
import { InjectSeedGit, type ReviewSeed, type SeedGitPort } from "@modules/integrations/seed"
import { attemptAsync } from "@modules/platform/primitives"

/** The refusal of a step: the field names the step; no value, no repository text and no cause travels. */
const refused = (field: string): WorkspaceSeedError =>
    new WorkspaceSeedError({ code: WorkspaceSeedErrorCode.InputInvalid, params: { field } })

/** The export target over an opened tree: text is written as it is; the secret members are sealed through sops with the tree's own rules. */
const targetOf = (tree: ReviewSeed): SeedStandardTarget => ({
    readText: (file) => Promise.resolve(tree.readText(file)),
    writeText: (file, text) => Promise.resolve(tree.writeText(file, text)),
    seal: async (file, values) => {
        const sealed = await attemptAsync(() => Promise.resolve(tree.sealText(file, stringify({ accounts: values }))))
        if (!sealed.ok) throw refused("seal")
        return sealed.value
    },
})

@Injectable()
/**
 * The export door's targets over the data standard's review tree: a `-seed-standard` working tree a person reviews and commits. Text is written
 * as it is; the secret members are serialized to YAML in memory and sealed THROUGH sops with the tree's own `.sops.yaml` (recipients: public
 * keys only), so a value reaches only sops's stdin.
 */
export class GitSeedStandardTargets implements SeedStandardTargets {
    constructor(@InjectSeedGit() private readonly git: SeedGitPort) {}

    /** Opens the working tree at a local path; a folder that is not a git tree is refused. */
    async open(path: string): Promise<SeedStandardTarget> {
        const tree = await this.git.review(path)
        if (!tree.ok) throw refused("to")
        return targetOf(tree.value)
    }
}
