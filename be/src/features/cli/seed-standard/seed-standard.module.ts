import { Module } from "@nestjs/common"
import { SeedStandardCli } from "./seed-standard.cli"
import { ConfigurableModuleClass } from "./seed-standard.module-definition"
import { StandardApplyCli } from "./subs/apply.cli"
import { StandardDoorsCli } from "./subs/doors.cli"
import { StandardExportCli } from "./subs/export.cli"
import { StandardResetCli } from "./subs/reset.cli"

@Module({ providers: [SeedStandardCli, StandardApplyCli, StandardDoorsCli, StandardExportCli, StandardResetCli] })
/** The seed-standard group: the bring-up's step, the door steps, the export door and the local reset; the work is the workspace seed's. */
export class SeedStandardModule extends ConfigurableModuleClass {}
