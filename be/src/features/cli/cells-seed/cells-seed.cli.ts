import { Command, CommandRunner } from "nest-commander"
import { CellsSeedApplyCli } from "./subs/apply.cli"
import { CellsSeedCheckCli } from "./subs/check.cli"

@Command({
    name: "cells-seed",
    description:
        "The V2 cell packages (seed data on the seed-standard road: a package folder pinned by commit, a receipt, a declared force once per commit, a removed version reported and never deleted). `check` judges every cell and graph of a package folder and prints READY or the refusals (no database); `apply` is the stack seed step command (--dry-run shows what would happen and writes nothing).",
    subCommands: [CellsSeedCheckCli, CellsSeedApplyCli],
})
/** `cli cells-seed`: the group; without a sub-command it shows its help. */
export class CellsSeedCli extends CommandRunner {
    /** Without a sub-command the group shows its help. */
    run(): Promise<void> {
        return this.command.help()
    }
}
