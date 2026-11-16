import { settingsOfStep, stepAccountsViewOf, stepRunModeViewOf, type StepSettingsWords } from "./workflowSettings"
import type { WorkflowNodeSettings } from "@/modules/types"

const words: StepSettingsWords = {
    runModeTitle: "mode",
    runModeAuto: "auto",
    runModeAutoNote: "auto note",
    runModeAsk: "ask",
    runModeAskNote: "ask note",
    runModeOwnerOnly: "owner only",
    runModeKeep: "keep",
    accountsTitle: "accounts",
    accountsHint: "hint",
    accountsNoneAttached: "none attached",
    accountsDefaultApplies: "default applies",
    accountsNotWorking: "not working",
    orderLine: (position) => `try ${position}`,
    providerName: (provider) => provider.toUpperCase(),
}

const account = (id: string, provider: string, extra: Partial<WorkflowNodeSettings["accounts"][number]> = {}) => ({
    connectionId: id,
    provider,
    label: `${provider}-${id}`,
    isDefault: false,
    sandbox: false,
    connected: true,
    ...extra,
})

const settings: WorkflowNodeSettings = {
    nodeKey: "send",
    settable: ["mode", "accounts"],
    mode: "ask",
    accountIds: ["z2", "t1", "z1"],
    accounts: [
        account("z1", "zalo", { isDefault: true }),
        account("z2", "zalo"),
        account("t1", "telegram", { sandbox: true }),
        account("z3", "zalo", { connected: false }),
    ],
}
const owner = { isOwner: true, isFrozen: false, isPending: false }

describe("step settings", () => {
    it("numbers the try order per provider, chosen accounts first", () => {
        const view = stepAccountsViewOf(settings, words, owner)
        expect(view?.options.map((option) => option.id)).toEqual(["z2", "t1", "z1", "z3"])
        expect(view?.options.map((option) => option.subtitle)).toEqual([
            "ZALO · try 1",
            "TELEGRAM · try 1",
            "ZALO · try 2",
            "ZALO · not working",
        ])
        expect(view?.value).toEqual(["z2", "t1", "z1"])
    })

    it("marks default and sandbox, and disables a not working account that is not chosen", () => {
        const view = stepAccountsViewOf(settings, words, owner)
        expect(view?.options.find((option) => option.id === "z1")?.isDefault).toBe(true)
        expect(view?.options.find((option) => option.id === "t1")?.isSandbox).toBe(true)
        expect(view?.options.find((option) => option.id === "z3")?.unavailable).toBe("not working")
    })

    it("lets a chosen account that stopped working be taken off", () => {
        const detached = { ...settings, accountIds: ["z3"] }
        expect(stepAccountsViewOf(detached, words, owner)?.options[0]?.unavailable).toBe("")
    })

    it("says the default applies when nothing is chosen", () => {
        expect(stepAccountsViewOf({ ...settings, accountIds: [] }, words, owner)?.note).toBe("default applies")
    })

    it("draws a setting only when the step takes it", () => {
        const none = { ...settings, settable: [] }
        expect(stepAccountsViewOf(none, words, owner)).toBeNull()
        expect(stepRunModeViewOf(none, words, { ...owner })).toBeNull()
        expect(stepAccountsViewOf(undefined, words, owner)).toBeNull()
        expect(settingsOfStep([settings], "other")).toBeUndefined()
    })

    it("locks both controls for anybody but the owner", () => {
        const reader = { isOwner: false, isFrozen: false, isPending: false }
        expect(stepAccountsViewOf(settings, words, reader)?.isReadOnly).toBe(true)
        const mode = stepRunModeViewOf(settings, words, reader)
        expect(mode?.isEditable).toBe(false)
        expect(mode?.ownerNote).toBe("owner only")
        expect(stepRunModeViewOf(settings, words, owner)?.isEditable).toBe(true)
        expect(stepRunModeViewOf(settings, words, owner)?.value).toBe("ask")
    })
})
