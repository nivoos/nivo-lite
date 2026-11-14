import { Injectable, type OnModuleInit } from "@nestjs/common"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import type { MaybeReason } from "./data-copies.contracts"
import { InjectDataBackupConfig } from "./data-copies.decorators"
import { DataCopiesLogEvent } from "./data-copies.log-events"
import type { DataBackupConfig } from "./data-copies.options"

@Injectable()
/** Says once, when the app starts, why no backup runs: the ticks of a deployment with no backup settings are a no-op and this is where the reason is logged. */
export class DataBackupNoticeService implements OnModuleInit {
    constructor(
        @InjectDataBackupConfig() private readonly config: DataBackupConfig,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** The reason no backup runs (the keys that explain it), or null when the backup is on. */
    reason(): MaybeReason {
        return this.config.enabled ? null : this.config.reason
    }

    /** Logs the reason when the backup is off. */
    onModuleInit(): void {
        const reason = this.reason()
        if (reason !== null) this.logger.warn(DataCopiesLogEvent.BackupDisabled, { reason })
    }
}
