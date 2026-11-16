import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { WorkspaceSettingsService, type WorkspaceTheme } from "@modules/domain/workspace-settings"
import { WorkspacesError, WorkspacesErrorCode } from "@modules/domain/workspaces"
import { recordEntry, type JsonValue } from "@modules/integrations/seed"
import { MemoryWorkspaceDirectory, entriesFrom } from "@tests/fixtures/builders/data-stores.builder"
import { DataStoresErrorCode } from "./errors/data-stores.error"
import { DATABASE_CANNOT, WORKSPACE_ROW_KEY } from "./data-stores.policy"
import { WorkspaceDatabaseStore } from "./workspace-database.adapter"
import { WorkspaceSettingsDoor } from "./workspace-settings.adapter"

const WORKSPACE = { id: "ws-1", ownerId: "owner-1" }
const THEME: WorkspaceTheme = {
    hue: 250,
    chroma: 0.2,
    lightness: 0.6,
    base: 0.3,
    font: "inter",
    radius: "md",
    mode: null,
}

/** The settings of one workspace the fake service holds. */
interface SettingsRow {
    name: string
    timeZone: string
    theme: WorkspaceTheme | null
}

/** The settings service over one in-memory row, validating like the real one for the two members it checks; `writes` names each write it served. */
const build = async (start: SettingsRow) => {
    const row = { ...start }
    const writes: Array<string> = []
    const settings = mock<WorkspaceSettingsService>()
    settings.get.mockImplementation(() =>
        Promise.resolve({ name: row.name, timeZone: row.timeZone, logoUrl: "https://dev.example/logo.png" }),
    )
    settings.update.mockImplementation(async (_id, change) => {
        await Promise.resolve()
        writes.push("update")
        if (change.name !== undefined) {
            if (change.name.trim() === "") throw new WorkspacesError({ code: WorkspacesErrorCode.NameInvalid })
            row.name = change.name
        }
        if (change.timeZone !== undefined) {
            if (change.timeZone === "Mars/Base")
                throw new WorkspacesError({ code: WorkspacesErrorCode.TimeZoneInvalid })
            row.timeZone = change.timeZone
        }
        return { name: row.name, timeZone: row.timeZone, logoUrl: null }
    })
    settings.getTheme.mockImplementation(() => Promise.resolve(row.theme))
    settings.setTheme.mockImplementation((_id, theme) => {
        writes.push("theme")
        row.theme = theme === null ? null : { ...THEME }
        return Promise.resolve(row.theme)
    })
    const moduleRef = await Test.createTestingModule({
        providers: [WorkspaceSettingsDoor, { provide: WorkspaceSettingsService, useValue: settings }],
    }).compile()
    const door = moduleRef.get(WorkspaceSettingsDoor)
    const store = new WorkspaceDatabaseStore(
        new MemoryWorkspaceDirectory({ "nivo-web": WORKSPACE }),
        [door],
        DATABASE_CANNOT,
        { workspace: "nivo-web" },
    )
    return { door, store, writes }
}

describe("WorkspaceSettingsDoor (set workspace)", () => {
    it("lists one row under the key settings: name, time zone and theme only, with the workspace id as its identity", async () => {
        const { door } = await build({ name: "NIVO Web", timeZone: "Asia/Ho_Chi_Minh", theme: THEME })

        const [row, ...rest] = await door.list(WORKSPACE)

        expect(rest).toEqual([])
        expect(row).toEqual({
            key: WORKSPACE_ROW_KEY,
            id: "ws-1",
            record: { name: "NIVO Web", theme: { ...THEME }, timeZone: "Asia/Ho_Chi_Minh" },
        })
        expect(JSON.stringify(row)).not.toContain("logo")
        expect(JSON.stringify(row?.record)).not.toContain("ws-1")
    })

    it("lists a workspace with no theme as null", async () => {
        const { door } = await build({ name: "Plain", timeZone: "Asia/Ho_Chi_Minh", theme: null })

        const [row] = await door.list(WORKSPACE)

        expect(row?.record).toMatchObject({ theme: null })
    })
})

describe("WorkspaceSettingsDoor (set workspace): writes", () => {
    it("updates in place through the settings service, keeps the identity, and a second import changes nothing", async () => {
        const { store, writes } = await build({ name: "Old", timeZone: "Asia/Ho_Chi_Minh", theme: null })
        const wanted = recordEntry("workspace", "settings", {
            name: "NIVO Web",
            theme: { ...THEME },
            timeZone: "Asia/Bangkok",
        })

        const first = await store.import(entriesFrom([wanted]), { dryRun: false, mode: "merge" })

        expect(first.sets[0]).toMatchObject({ created: 0, updated: 1, unchanged: 0 })
        expect(await store.identityOf("workspace", "settings")).toBe("ws-1")
        const second = await store.import(entriesFrom([wanted]), { dryRun: false, mode: "merge" })
        expect(second.outcome).toBe("unchanged")
        expect(writes).toEqual(["update", "theme"])
    })

    it("leaves a member the record does not carry as it is, and clears the theme only when it is null", async () => {
        const { door, store } = await build({ name: "Keep", timeZone: "Asia/Ho_Chi_Minh", theme: THEME })

        await store.import(entriesFrom([recordEntry("workspace", "settings", { timeZone: "Asia/Tokyo" })]), {
            dryRun: false,
            mode: "merge",
        })
        const [kept] = await door.list(WORKSPACE)
        expect(kept?.record).toEqual({ name: "Keep", theme: { ...THEME }, timeZone: "Asia/Tokyo" })
        await store.import(entriesFrom([recordEntry("workspace", "settings", { theme: null })]), {
            dryRun: false,
            mode: "merge",
        })

        expect((await door.list(WORKSPACE))[0]?.record).toMatchObject({ theme: null })
    })

    it("reports a member the service refuses by the module's own code, and a record of the wrong shape by ours", async () => {
        const { store } = await build({ name: "N", timeZone: "Asia/Ho_Chi_Minh", theme: null })
        const wrongShape: JsonValue = { name: 5 }

        const report = await store.import(
            entriesFrom([
                recordEntry("workspace", "settings", { timeZone: "Mars/Base" }),
                recordEntry("workspace", "other-key", { name: "X" }),
            ]),
            { dryRun: false, mode: "merge" },
        )
        const wrong = await store.import(entriesFrom([recordEntry("workspace", "settings", wrongShape)]), {
            dryRun: false,
            mode: "merge",
        })

        expect(report.outcome).toBe("partial")
        expect(report.sets[0]?.refused).toEqual([
            { key: "settings", code: WorkspacesErrorCode.TimeZoneInvalid },
            { key: "other-key", code: DataStoresErrorCode.RecordInvalid },
        ])
        expect(wrong.sets[0]?.refused).toEqual([{ key: "settings", code: DataStoresErrorCode.RecordInvalid }])
    })

    it("has no removing door: a mirror never removes the settings row", async () => {
        const { door } = await build({ name: "N", timeZone: "Asia/Ho_Chi_Minh", theme: null })

        expect("remove" in door).toBe(false)
    })
})
