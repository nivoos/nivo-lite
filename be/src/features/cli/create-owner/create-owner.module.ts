import { Module } from "@nestjs/common"
import { CreateOwnerCli } from "./create-owner.cli"
import { ConfigurableModuleClass } from "./create-owner.module-definition"
import { RenameOwnerCli } from "./subs/rename.cli"
import { RunCreateOwnerCli } from "./subs/run.cli"

@Module({ providers: [CreateOwnerCli, RunCreateOwnerCli, RenameOwnerCli] })
/** The create-owner group: the command and its sub-commands (run, rename) over the owner bootstrap. */
export class CreateOwnerModule extends ConfigurableModuleClass {}
