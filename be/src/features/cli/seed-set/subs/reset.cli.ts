import { text } from "node:stream/consumers"
import { CommandRunner, Option, SubCommand } from "nest-commander"
import { SetSeedService } from "@modules/domain/workspace-seed"

/** What `seed-set reset` is asked to do, as the command line parsed it. */
export interface SeedSetResetCommand {
    /** The stack environment: `dev`. */
    readonly env: string
    /** Whether to remove; without it the command prints the plan and removes nothing. */
    readonly execute: boolean
}

@SubCommand({
    name: "reset",
    description:
        "Take the workspace of the set on stdin off the local stack through the owner's delete door (a soft delete); dry by default, --execute removes; an overlay set never removes its workspace",
})
/** `cli seed-set reset --env dev [--execute] < <set document>`: run by hand. */
export class SetResetCli extends CommandRunner {
    constructor(private readonly seed: SetSeedService) {
        super()
    }

    /** Hands the whole of stdin, the environment and the execute choice to the set seed, which prints the plan and what it removed. */
    async run(_params: Array<string>, options: SeedSetResetCommand): Promise<void> {
        await this.seed.reset(await text(process.stdin), options.env, options.execute)
    }

    /** The environment; none given is the empty name, which the seed refuses. */
    @Option({ flags: "--env <name>", description: "The stack environment: dev", defaultValue: "" })
    parseEnv(value: string): string {
        return value
    }

    /** Removes instead of printing the plan. */
    @Option({ flags: "--execute", description: "Remove; without it nothing is removed", defaultValue: false })
    parseExecute(): boolean {
        return true
    }
}
