import { METHOD_METADATA, PATH_METADATA, SSE_METADATA } from "@nestjs/common/constants"
import type { MessageEvent } from "@nestjs/common"
import { RequestMethod } from "@nestjs/common"
import { validate } from "class-validator"
import { EMPTY, firstValueFrom, of } from "rxjs"
import { mock } from "@starci/jest-preset"
import type { WorkspaceMembersService } from "@modules/domain/workspace-members"
import { JobProgressAccessService } from "@modules/domain/job-ops"
import type { Principal } from "@modules/platform/cqrs"
import type { JobProgressStreamService } from "@modules/platform/jobs"
import { JobProgressController } from "./job-progress.controller"
import { JobProgressStreamQuery } from "./job-progress.query"

const principal: Principal = { id: "person-1", role: "authenticated" }
const WS = "ws-1"
const EVENT: MessageEvent = { id: "x", data: { id: "x" } }

const build = () => {
    const progress = mock<JobProgressStreamService>()
    progress.open.mockReturnValue(of(EVENT))
    const members = mock<WorkspaceMembersService>()
    members.require.mockResolvedValue({} as never)
    return { door: new JobProgressController(new JobProgressAccessService(members, progress)), progress, members }
}

const refused = async (query: Partial<JobProgressStreamQuery>): Promise<boolean> =>
    (await validate(Object.assign(new JobProgressStreamQuery(), query))).length > 0

describe("JobProgressStreamQuery", () => {
    it("accepts one root, a list of roots, or neither", async () => {
        await expect(refused({ root: "k:1" })).resolves.toBe(false)
        await expect(refused({ roots: "k:1,k:2" })).resolves.toBe(false)
        await expect(refused({})).resolves.toBe(false)
    })

    it("refuses a malformed root and a list over the bound or with a malformed member", async () => {
        const tooMany = Array.from({ length: 51 }, (_, index) => `k:${index}`).join(",")

        await expect(refused({ root: "no-kind" })).resolves.toBe(true)
        await expect(refused({ roots: "k:1,bad" })).resolves.toBe(true)
        await expect(refused({ roots: tooMany })).resolves.toBe(true)
    })
})

describe("JobProgressController", () => {
    it("opens the stream of the caller's workspace and chain after proving membership", async () => {
        const { door, progress, members } = build()

        await expect(firstValueFrom(door.stream(principal, WS, { root: "k:1" }, "x:0"))).resolves.toEqual(EVENT)

        expect(members.require).toHaveBeenCalledWith("person-1", WS)
        expect(progress.open).toHaveBeenCalledWith({ workspaceId: WS, root: "k:1", roots: undefined }, "x:0")
    })

    it("opens the stream of the listed chains, or of the whole workspace when none is named", async () => {
        const { door, progress } = build()

        await firstValueFrom(door.stream(principal, WS, { roots: "k:1,k:2" }))
        await firstValueFrom(door.stream(principal, WS, {}))

        expect(progress.open).toHaveBeenNthCalledWith(1, { workspaceId: WS, root: undefined, roots: "k:1,k:2" }, undefined)
        expect(progress.open).toHaveBeenNthCalledWith(2, { workspaceId: WS, root: undefined, roots: undefined }, undefined)
    })

    it("opens nothing for a caller that is not a member", async () => {
        const { door, progress, members } = build()
        members.require.mockRejectedValue(new Error("not a member"))

        await expect(firstValueFrom(door.stream(principal, WS, { root: "k:1" }))).rejects.toThrow("not a member")

        expect(progress.open).not.toHaveBeenCalled()
    })

    it("reads nothing before the stream is subscribed", () => {
        const { door, members } = build()
        members.require.mockReturnValue(EMPTY as never)

        door.stream(principal, WS, { root: "k:1" })

        expect(members.require).not.toHaveBeenCalled()
    })

    it("is one GET event stream with no other handler", () => {
        const { door } = build()

        expect(Reflect.getMetadata(SSE_METADATA, door.stream)).toBe(true)
        expect(Reflect.getMetadata(METHOD_METADATA, door.stream)).toBe(RequestMethod.GET)
        expect(Reflect.getMetadata(PATH_METADATA, JobProgressController)).toBe("realtime/job-progress")
        expect(Object.getOwnPropertyNames(JobProgressController.prototype)).toEqual(["constructor", "stream"])
    })
})
