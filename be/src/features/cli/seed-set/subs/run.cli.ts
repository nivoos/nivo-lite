import { text } from "node:stream/consumers"
import { CommandRunner, Option, SubCommand } from "nest-commander"
import { SetSeedService } from "@modules/domain/workspace-seed"

/** What `seed-set run` is asked to do, as the command line parsed it. */
export interface SeedSetRunCommand {
    /** The stack environment: `dev` (a set is refused anywhere else). */
    readonly env: string
    /** Print the plan and write nothing. */
    readonly dry: boolean
    /** Also bind each customer channel to the front door of the set's agents. */
    readonly bind: boolean
}

@SubCommand({
    name: "run",
    description:
        "Seed the set of the document on stdin into its workspace (made when missing): accounts, agents, truths and their judgement; every step finds before it writes, so a second run changes nothing; --dry prints the plan only; --bind also binds the customer channels to the agents' front doors",
})
/** `cli seed-set run --env dev [--dry] [--bind] < <set document>`: run by hand, never by the stack seed step. */
export class SetRunCli extends CommandRunner {
    constructor(private readonly seed: SetSeedService) {
        super()
    }

    /** Hands the whole of stdin, the environment and the choices to the set seed, which prints what it did, ending with `unchanged` when nothing changed. */
    async run(_params: Array<string>, options: SeedSetRunCommand): Promise<void> {
        await this.seed.run(await text(process.stdin), options.env, { dry: options.dry, bind: options.bind })
    }

    /** The environment; none given is the empty name, which the seed refuses. */
    @Option({ flags: "--env <name>", description: "The stack environment: dev", defaultValue: "" })
    parseEnv(value: string): string {
        return value
    }

    /** Prints the plan only. */
    @Option({ flags: "--dry", description: "Print the plan; write nothing", defaultValue: false })
    parseDry(): boolean {
        return true
    }

    /** Binds the customer channels. */
    @Option({ flags: "--bind", description: "Bind each customer channel of the workspace to its agent's front door", defaultValue: false })
    parseBind(): boolean {
        return true
    }
}
