import { Command, CommandRunner } from "nest-commander"
import { StandardApplyCli } from "./subs/apply.cli"
import { StandardDoorsCli } from "./subs/doors.cli"
import { StandardExportCli } from "./subs/export.cli"
import { StandardRecordDoorsCli } from "./subs/record-doors.cli"
import { StandardResetCli } from "./subs/reset.cli"

@Command({
    name: "seed-standard",
    description:
        "The SEED STANDARDS of the stack (`<name>-seed-standard` repos pinned by commit, R98-R104). `apply` is the STACK SEED STEP's own command (the bring-up runs it with the stack's declarations on stdin; a standard is loaded once, a declared force re-seeds once per commit; no person loads a standard by hand); `doors` prints the door steps (time zone, node settings) for the door script; `export` writes a working workspace into a checkout of its standard for review and re-pinning; `record-doors` records the door script's outcomes in the receipts (a refused door step is a FAILED seed step); `reset` takes a standard's workspace off the local stack.",
    subCommands: [StandardApplyCli, StandardDoorsCli, StandardExportCli, StandardRecordDoorsCli, StandardResetCli],
})
/** `cli seed-standard`: the group; without a sub-command it shows its help. */
export class SeedStandardCli extends CommandRunner {
    /** Without a sub-command the group shows its help. */
    run(): Promise<void> {
        return this.command.help()
    }
}
