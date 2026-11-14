import { Module } from "@nestjs/common"
import { ConfigurableModuleClass } from "./data-copies.module-definition"
import { DataCopiesQueue } from "./data-copies.queue"

@Module({ providers: [DataCopiesQueue], exports: [DataCopiesQueue] })
/** The data-copies queue: its typed producer, imported by the domain module whose service enqueues. */
export class DataCopiesQueueModule extends ConfigurableModuleClass {}
