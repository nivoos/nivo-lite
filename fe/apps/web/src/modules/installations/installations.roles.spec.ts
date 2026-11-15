import type { ModuleCopy } from "@/modules/catalog"
import { catalogRolesOf } from "./installations.roles"
import type { Installation } from "./installations.types"

const bilingual = (text: string) => ({ vi: text, en: text })

/** A catalogue row as the back end serves it; the keys here are invented: no package of the lane declares them. */
const copyOf = (key: string, over: Partial<ModuleCopy> = {}): ModuleCopy => ({
    key,
    plugin: { key: "plugin", label: bilingual("Plugin") },
    order: 0,
    name: bilingual(`Name ${key}`),
    shortName: bilingual(`Short ${key}`),
    description: bilingual(`Description ${key}`),
    points: { vi: [`Point ${key}`], en: [`Point ${key}`] },
    icon: "support",
    glyph: "M5 5h14v14H5z",
    mascot: `/images/${key}.png`,
    category: "group",
    status: "stable",
    audience: "customer",
    includedWithWorkspace: false,
    available: true,
    knowledgeFolder: key,
    knowledgeIdeas: [],
    workbench: null,
    settingsExtras: null,
    requires: { capabilities: [], connections: [] },
    connectionProviders: [],
    defaultOperatingMode: "assist",
    multiInstance: false,
    gates: [],
    ...over,
})

const installationOf = (moduleKey: string, id: string): Installation => ({
    id,
    workspaceId: "w1",
    moduleKey,
    name: id,
    isMulti: false,
    agentId: `agent-${id}`,
    agentAvatarUrl: null,
    agentAvatarPreset: null,
    agentHandle: id,
    status: "live",
    lifecycle: "running",
    connectionNeeds: [],
    operatingMode: "assist",
    liveEnabled: true,
    activeContextVersionId: null,
    activeVersion: null,
    settings: {},
    createdAt: "2026-11-01T00:00:00.000Z",
    setupProgress: { confirmed: 0, total: 0 },
})

const categories = [{ key: "group", label: bilingual("Group") }]

describe("catalogRolesOf: the roles are the catalogue the back end served the workspace", () => {
    it("lists a public module and a private module the app source never names, none dropped", () => {
        const roles = catalogRolesOf({
            modules: [copyOf("public_front"), copyOf("private_desk", { order: 1 })],
            categories,
            installations: [],
            workspaceId: "w1",
            locale: "en",
        })
        expect(roles.map((role) => role.key)).toEqual(["public_front", "private_desk"])
        expect(roles.map((role) => role.name)).toEqual(["Name public_front", "Name private_desk"])
        expect(roles.map((role) => role.mascot)).toEqual(["/images/public_front.png", "/images/private_desk.png"])
    })

    it("keeps the rule of installed roles: a single-instance role that is installed does not repeat, a multi-instance one adds", () => {
        const roles = catalogRolesOf({
            modules: [copyOf("single"), copyOf("many", { multiInstance: true }), copyOf("fresh")],
            categories,
            installations: [installationOf("single", "i1"), installationOf("many", "i2")],
            workspaceId: "w1",
            locale: "vi",
        })
        expect(roles.map((role) => role.key)).toEqual(["many", "fresh"])
        const many = roles.find((role) => role.key === "many")
        expect(many?.installed).toBe(true)
        expect(many?.addHref).toContain("/many")
        expect(many?.openHref).toContain("/many/i2")
        expect(roles.find((role) => role.key === "fresh")?.installed).toBe(false)
    })

    it("lists nothing a catalogue did not serve, even when the workspace has an agent of that type", () => {
        const roles = catalogRolesOf({
            modules: [copyOf("served")],
            categories,
            installations: [installationOf("unserved", "i1")],
            workspaceId: "w1",
            locale: "en",
        })
        expect(roles.map((role) => role.key)).toEqual(["served"])
    })

    it("does not offer a module whose template declares `available: false`, a public one or a private one", () => {
        const roles = catalogRolesOf({
            modules: [
                copyOf("public_front"),
                copyOf("public_early", { available: false }),
                copyOf("private_desk", { available: false, plugin: { key: "private", label: bilingual("Private") } }),
            ],
            categories,
            installations: [],
            workspaceId: "w1",
            locale: "en",
        })
        expect(roles.map((role) => role.key)).toEqual(["public_front"])
    })

    it("keeps an installed agent of an unavailable module listed and open, with no way to add another", () => {
        const roles = catalogRolesOf({
            modules: [copyOf("many", { available: false, multiInstance: true }), copyOf("single", { available: false })],
            categories,
            installations: [installationOf("many", "i2"), installationOf("single", "i3")],
            workspaceId: "w1",
            locale: "en",
        })
        expect(roles.map((role) => role.key)).toEqual(["many"])
        expect(roles[0]?.installed).toBe(true)
        expect(roles[0]?.openHref).toContain("/many/i2")
        expect(roles[0]?.addHref).toBeNull()
    })
})
