import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { SeedGitPort } from "@modules/integrations/seed"
import { NIVO_SET, memoryDriver } from "@tests/fixtures/builders/data-copies.builder"
import {
    backupConfigOf,
    backupDriverIdOf,
    backupSlotOf,
    dataSetOf,
    driversOfConfig,
    setsOfConfig,
} from "./data-backup-config.policy"
import type { DataBackupConfig, DataBackupValues } from "./data-copies.options"

const SUBJECT = Symbol("data-backup-config.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [
            {
                provide: SUBJECT,
                useValue: { backupConfigOf, backupDriverIdOf, backupSlotOf, dataSetOf, driversOfConfig, setsOfConfig },
            },
        ],
    }).compile()
    return moduleRef.get<typeof import("./data-backup-config.policy")>(SUBJECT)
}

const ON: DataBackupConfig = {
    enabled: true,
    environment: "dev",
    checkout: "/outside/backup-dev",
    remote: "https://example.invalid/r",
    recipients: ["age1x"],
}
const OFF: DataBackupConfig = { enabled: false, reason: "not declared" }

const RECIPIENT = `age1${"q".repeat(58)}`
const IDENTITY = "AGE-SECRET-KEY-FAKE"

/** The raw values of a declared backup: dev, a checkout and two recipients (with a blank after the comma); `over` changes a member. */
const declared = (over: Partial<DataBackupValues> = {}): DataBackupValues => ({
    environment: "dev",
    checkout: "/outside/backup-dev",
    recipients: `${RECIPIENT}, ${RECIPIENT}`,
    remote: undefined,
    ...over,
})

describe("the scheduled backup's settings", () => {
    it("is disabled with the reason when nothing is declared, never a failure", async () => {
        const subject = await build()

        expect(
            subject.backupConfigOf({
                environment: undefined,
                checkout: undefined,
                recipients: undefined,
                remote: undefined,
            }),
        ).toEqual({
            enabled: false,
            reason: "DATA_BACKUP_ENV, DATA_BACKUP_CHECKOUT and DATA_BACKUP_RECIPIENTS are not declared",
        })
    })

    it("is disabled naming the missing keys, and an environment other than dev or prod", async () => {
        const subject = await build()

        expect(subject.backupConfigOf(declared({ checkout: undefined, recipients: undefined }))).toEqual({
            enabled: false,
            reason: "DATA_BACKUP_CHECKOUT, DATA_BACKUP_RECIPIENTS missing or invalid",
        })
        expect(subject.backupConfigOf(declared({ environment: "staging" }))).toEqual({
            enabled: false,
            reason: "DATA_BACKUP_ENV (dev or prod) missing or invalid",
        })
    })

    it("is disabled when the recipients are empty or not public age keys, and never echoes the value (a secret key is refused)", async () => {
        const subject = await build()

        const secretKey = subject.backupConfigOf(declared({ recipients: IDENTITY }))
        const empty = subject.backupConfigOf(declared({ recipients: " , " }))

        expect(secretKey).toEqual({
            enabled: false,
            reason: "DATA_BACKUP_RECIPIENTS must hold at least one public age recipient (age1...)",
        })
        expect(JSON.stringify(secretKey)).not.toContain(IDENTITY)
        expect(empty.enabled).toBe(false)
    })

    it("is enabled for one environment with its checkout, its public recipients (trimmed) and an optional remote", async () => {
        const subject = await build()

        expect(subject.backupConfigOf(declared())).toEqual({
            enabled: true,
            environment: "dev",
            checkout: "/outside/backup-dev",
            remote: undefined,
            recipients: [RECIPIENT, RECIPIENT],
        })
        expect(
            subject.backupConfigOf(
                declared({ environment: "prod", remote: "https://example.invalid/nivo-lite-seed-backup-prod" }),
            ),
        ).toMatchObject({
            enabled: true,
            environment: "prod",
            remote: "https://example.invalid/nivo-lite-seed-backup-prod",
        })
    })
})

describe("the data set a deployment keeps copies of", () => {
    it("names the backup repository driver of the environment, and declares one daily seed-backup set that reads both stores", async () => {
        const subject = await build()

        expect(subject.backupDriverIdOf("prod")).toBe("nivo-lite-seed-backup-prod")
        expect(subject.dataSetOf("nivo-lite-seed-backup-dev")).toEqual({
            ...NIVO_SET,
            drivers: ["nivo-lite-seed-backup-dev"],
        })
    })

    it("declares the set and the driver only while the backup is on", async () => {
        const subject = await build()
        const git = mock<SeedGitPort>()
        git.backupDriver.mockReturnValue(memoryDriver({ id: "nivo-lite-seed-backup-dev" }))

        expect(subject.setsOfConfig(OFF)).toEqual([])
        expect(subject.setsOfConfig(ON).map((set) => set.drivers)).toEqual([["nivo-lite-seed-backup-dev"]])
        expect(subject.driversOfConfig(OFF, git)).toEqual([])
        expect(subject.driversOfConfig(ON, git).map((driver) => driver.id)).toEqual(["nivo-lite-seed-backup-dev"])
        expect(git.backupDriver).toHaveBeenCalledWith({
            id: "nivo-lite-seed-backup-dev",
            checkout: "/outside/backup-dev",
            remote: "https://example.invalid/r",
        })
    })

    it("puts two ticks of one period in one slot and the next period in the next", async () => {
        const subject = await build()

        expect(subject.backupSlotOf(NIVO_SET, new Date("2026-11-14T01:00:00.000Z"))).toBe(
            subject.backupSlotOf(NIVO_SET, new Date("2026-11-14T22:00:00.000Z")),
        )
        expect(subject.backupSlotOf(NIVO_SET, new Date("2026-11-15T01:00:00.000Z"))).toBe(
            subject.backupSlotOf(NIVO_SET, new Date("2026-11-14T01:00:00.000Z")) + 1,
        )
    })
})
