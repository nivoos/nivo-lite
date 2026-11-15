import { Module } from "@nestjs/common"
import { CellsSeedCli } from "./cells-seed.cli"
import { ConfigurableModuleClass } from "./cells-seed.module-definition"
import { PackageFolderClient } from "./package-folder.client"
import { CellsSeedApplyCli } from "./subs/apply.cli"
import { CellsSeedCheckCli } from "./subs/check.cli"

@Module({ providers: [CellsSeedCli, CellsSeedCheckCli, CellsSeedApplyCli, PackageFolderClient] })
/** The cells-seed group. The work is `CellSeedService` of the cells capability, which the cli composition root provides (`CellsModule`, seed only). */
export class CellsSeedModule extends ConfigurableModuleClass {}
