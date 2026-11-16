import { toInstallations } from "./installations.wire"

const rowOf = (moduleKey: string, id: string, createdAt: string) => ({
    id,
    workspaceId: "w1",
    moduleKey,
    name: id,
    isMulti: false,
    agentId: `agent-${id}`,
    agentName: id,
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
    createdAt,
    setupProgress: { confirmed: 1, total: 1 },
})

describe("toInstallations: every row the back end returned is an installed agent", () => {
    it("keeps the rows of a public module and of a private module the app source never names, oldest first", () => {
        const installed = toInstallations([
            rowOf("private_desk", "b", "2026-11-02T00:00:00.000Z"),
            rowOf("public_front", "a", "2026-11-01T00:00:00.000Z"),
        ])
        expect(installed.map((one) => [one.id, one.moduleKey])).toEqual([
            ["a", "public_front"],
            ["b", "private_desk"],
        ])
    })
})
