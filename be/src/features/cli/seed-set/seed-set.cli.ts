import { Command, CommandRunner } from "nest-commander"
import { SetDoorsCli } from "./subs/doors.cli"
import { SetResetCli } from "./subs/reset.cli"
import { SetRunCli } from "./subs/run.cli"

@Command({
    name: "seed-set",
    description:
        "A whole test workspace from one set profile (a document `nivo/set-seed@1` on stdin): the workspace, its agents, its SANDBOX accounts, its truths with their policy judgement. Local stack only, by hand (never in the stack seed manifest). `run` writes (dry with --dry), `doors` prints the steps that write the people and their history through the providers' own inbound doors, `reset` takes the workspace off the local stack.",
    subCommands: [SetRunCli, SetDoorsCli, SetResetCli],
})
/** `cli seed-set`: the seed-set group; its commands are `run`, `doors` and `reset`. */
export class SeedSetCli extends CommandRunner {
    /** Without a sub-command the group shows its help. */
    run(): Promise<void> {
        return this.command.help()
    }
}
