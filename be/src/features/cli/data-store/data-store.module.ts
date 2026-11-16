import { Module } from "@nestjs/common"
import { DataStoreCli } from "./data-store.cli"
import { ConfigurableModuleClass } from "./data-store.module-definition"

@Module({ providers: [DataStoreCli] })
/** The data-store command over the data stores capability. */
export class DataStoreCliModule extends ConfigurableModuleClass {}
