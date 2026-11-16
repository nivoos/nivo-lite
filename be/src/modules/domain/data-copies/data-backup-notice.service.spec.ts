import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { DataBackupNoticeService } from "./data-backup-notice.service"
import { DATA_BACKUP_CONFIG } from "./data-copies.decorators"
import type { DataBackupConfig } from "./data-copies.options"

const build = async (config: DataBackupConfig) => {
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            DataBackupNoticeService,
            { provide: DATA_BACKUP_CONFIG, useValue: mock<DataBackupConfig>(config) },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return { service: moduleRef.get(DataBackupNoticeService), logger }
}

describe("DataBackupNoticeService", () => {
    it("names the keys that explain why no backup runs, and says it once when the app starts", async () => {
        const t = await build({
            enabled: false,
            reason: "DATA_BACKUP_ENV, DATA_BACKUP_CHECKOUT and DATA_BACKUP_RECIPIENTS are not declared",
        })

        expect(t.service.reason()).toBe(
            "DATA_BACKUP_ENV, DATA_BACKUP_CHECKOUT and DATA_BACKUP_RECIPIENTS are not declared",
        )
        t.service.onModuleInit()
        expect(t.logger.warn).toHaveBeenCalledTimes(1)
        expect(t.logger.warn).toHaveBeenCalledWith("data.backup.disabled", {
            reason: "DATA_BACKUP_ENV, DATA_BACKUP_CHECKOUT and DATA_BACKUP_RECIPIENTS are not declared",
        })
    })

    it("has no reason and says nothing when the backup is on", async () => {
        const t = await build({
            enabled: true,
            environment: "dev",
            checkout: "/c",
            remote: undefined,
            recipients: ["age1x"],
        })

        expect(t.service.reason()).toBeNull()
        t.service.onModuleInit()
        expect(t.logger.warn).not.toHaveBeenCalled()
    })
})
