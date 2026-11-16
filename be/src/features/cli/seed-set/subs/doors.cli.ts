import { text } from "node:stream/consumers"
import { CommandRunner, Option, SubCommand } from "nest-commander"
import { SetSeedService } from "@modules/domain/workspace-seed"

/** What `seed-set doors` is asked to do, as the command line parsed it. */
export interface SeedSetDoorsCommand {
    /** The stack environment: `dev`. */
    readonly env: string
}

@SubCommand({
    name: "doors",
    description:
        "Print, one JSON object a line, the steps that write the people of the set and their history through the providers' own inbound doors (a line on an account, a merge of one person's contacts, a node step's chosen accounts); writes nothing",
})
/** `cli seed-set doors --env dev < <set document>`: the door script reads its lines. */
export class SetDoorsCli extends CommandRunner {
    constructor(private readonly seed: SetSeedService) {
        super()
    }

    /** Hands the whole of stdin and the environment to the set seed, which prints the steps. */
    async run(_params: Array<string>, options: SeedSetDoorsCommand): Promise<void> {
        await this.seed.doors(await text(process.stdin), options.env)
    }

    /** The environment; none given is the empty name, which the seed refuses. */
    @Option({ flags: "--env <name>", description: "The stack environment: dev", defaultValue: "" })
    parseEnv(value: string): string {
        return value
    }
}
