import { Module, type OnModuleInit } from "@nestjs/common"
import { InjectJobProcessorRegistry, type JobProcessorRegistry } from "@modules/platform/jobs"
import { DataBackupModule } from "../../data-backup.module"
import { ConfigurableModuleClass } from "./data-backup-queue.module-definition"
import { BackupDueProcessor, DataBackupProcessor } from "./data-backup.processor"

@Module({ imports: [DataBackupModule.register({})], providers: [BackupDueProcessor, DataBackupProcessor] })
/** The queue transport of the data-backup jobs: registers the tick's processor and the backup's with the job runner. Not in the API composition until the real drivers are bound. */
export class DataBackupQueueModule extends ConfigurableModuleClass implements OnModuleInit {
    constructor(
        @InjectJobProcessorRegistry() private readonly registry: JobProcessorRegistry,
        private readonly due: BackupDueProcessor,
        private readonly backup: DataBackupProcessor,
    ) {
        super()
    }

    /** Hands both processors to the registry. */
    onModuleInit(): void {
        this.registry.add(this.due)
        this.registry.add(this.backup)
    }
}
