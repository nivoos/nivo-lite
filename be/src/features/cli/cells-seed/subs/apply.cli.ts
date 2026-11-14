import { CommandRunner, Option, SubCommand } from "nest-commander"
import { CellSeedService } from "@modules/domain/cells"
import { PackageFolderClient } from "../package-folder.client"

/** What `cells-seed apply` is asked to do, as the command line parsed it. */
export interface CellsSeedApplyCommand {
    /** The package folder, a checkout at the pinned commit. */
    readonly dir: string
    /** Where the repository is fetched from. */
    readonly repository: string
    /** The pinned commit. */
    readonly commit: string
    /** The declared force. */
    readonly force: boolean
    /** Show what would happen and write nothing. */
    readonly dryRun: boolean
}

@SubCommand({
    name: "apply",
    description:
        "The stack seed step command: seed the package folder (a checkout at the pinned commit) into the cells tables once (its receipt skips a later run); a declared --force re-applies once per commit, every row unchanged when the files did not change; a version the package no longer holds is reported, never deleted; --dry-run writes nothing",
})
/** `cli cells-seed apply --dir <folder> --repository <repo> --commit <sha> [--force] [--dry-run]`: run by the stack bring-up. */
export class CellsSeedApplyCli extends CommandRunner {
    constructor(
        private readonly seed: CellSeedService,
        private readonly folder: PackageFolderClient,
    ) {
        super()
    }

    /** Prints what the seed did; the last line is `applied`, `unchanged` or `skipped`; a refused thing sets a non-zero exit. */
    async run(_params: Array<string>, options: CellsSeedApplyCommand): Promise<void> {
        const view = await this.seed.apply({
            files: await this.folder.read(options.dir),
            origin: { repository: options.repository, commit: options.commit },
            force: options.force,
            dry: options.dryRun,
        })
        process.stdout.write(`${view.lines.join("\n")}\n`)
        process.exitCode = Number(!view.ready)
    }

    /** The package folder. */
    @Option({ flags: "--dir <folder>", description: "The package folder, a checkout at the pinned commit", defaultValue: "" })
    parseDir(value: string): string {
        return value
    }

    /** The repository. */
    @Option({ flags: "--repository <repo>", description: "Where the repository is fetched from", defaultValue: "" })
    parseRepository(value: string): string {
        return value
    }

    /** The pinned commit. */
    @Option({ flags: "--commit <sha>", description: "The pinned commit", defaultValue: "" })
    parseCommit(value: string): string {
        return value
    }

    /** The declared force. */
    @Option({ flags: "--force", description: "Re-apply once at this commit (the declared force)", defaultValue: false })
    parseForce(): boolean {
        return true
    }

    /** The dry run. */
    @Option({ flags: "--dry-run", description: "Print what would happen; write nothing", defaultValue: false })
    parseDryRun(): boolean {
        return true
    }
}
