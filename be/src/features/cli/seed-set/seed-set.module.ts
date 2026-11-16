import { Module } from "@nestjs/common"
import { SeedSetCli } from "./seed-set.cli"
import { ConfigurableModuleClass } from "./seed-set.module-definition"
import { SetDoorsCli } from "./subs/doors.cli"
import { SetResetCli } from "./subs/reset.cli"
import { SetRunCli } from "./subs/run.cli"

@Module({ providers: [SeedSetCli, SetRunCli, SetDoorsCli, SetResetCli] })
/** The seed-set group: its command and its sub-commands; the work is the set seed of the workspace seed. */
export class SeedSetModule extends ConfigurableModuleClass {}
