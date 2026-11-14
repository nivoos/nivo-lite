import { Test } from "@nestjs/testing"
import {
    customerObjectPathOf,
    fileOfKept,
    isCustomerFilePath,
    keptFileOf,
    picturesNotSeenOf,
    withPicturesNotSeen,
} from "./customer-files.policy"

const SUBJECT = Symbol("customer-files.policy")

/** The policy as Nest hands it to a caller. */
const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [
            {
                provide: SUBJECT,
                useValue: { customerObjectPathOf, fileOfKept, isCustomerFilePath, keptFileOf, picturesNotSeenOf, withPicturesNotSeen },
            },
        ],
    }).compile()
    return moduleRef.get<typeof import("./customer-files.policy")>(SUBJECT)
}

describe("customer files policy", () => {
    it("tells a step the pictures it was not shown as a fact of its input, and adds nothing when it saw them all", async () => {
        const policy = await build()
        expect(policy.withPicturesNotSeen({ text: "this sample" }, 0)).toEqual({ text: "this sample" })
        expect(policy.withPicturesNotSeen({ text: "this sample" }, 1)).toEqual({
            text: "this sample",
            picturesNotSeen: policy.picturesNotSeenOf(1),
        })
        expect(policy.withPicturesNotSeen("this sample", 2)).toEqual({
            input: "this sample",
            picturesNotSeen: policy.picturesNotSeenOf(2),
        })
        expect(policy.picturesNotSeenOf(1).note).toContain("Never say or imply you saw them")
    })

    it("keeps a customer's file under its workspace, one path per message and position", async () => {
        const policy = await build()
        const path = policy.customerObjectPathOf("ws-1", "zalo:m-1", 0, "image/png")
        expect(path).toBe(policy.customerObjectPathOf("ws-1", "zalo:m-1", 0, "image/png"))
        expect(path).not.toBe(policy.customerObjectPathOf("ws-1", "zalo:m-1", 1, "image/png"))
        expect(policy.isCustomerFilePath("ws-1", path)).toBe(true)
        expect(policy.isCustomerFilePath("ws-2", path)).toBe(false)
        expect(policy.isCustomerFilePath("ws-1", "ws-1/chat/customer/../office/x.png")).toBe(false)
    })

    it("keeps a file entry on the ledger as JSON and reads the same entry back, a not-kept one with its reason", async () => {
        const policy = await build()
        const kept = { id: "ws-1/chat/customer/k-0.jpg", url: "chat-file:ws-1/chat/customer/k-0.jpg", name: "k-0.jpg", contentType: "image/jpeg" }
        const refused = { id: "unread:refused_404:1", url: "", name: "", contentType: "image/*", notKept: "refused_404" as const }

        expect(policy.fileOfKept(policy.keptFileOf(kept), 0, "image", "")).toEqual(kept)
        expect(policy.fileOfKept(policy.keptFileOf(refused), 1, "image", "")).toEqual(refused)
        expect(policy.keptFileOf(kept)).not.toHaveProperty("notKept")
    })

    it("reads a ledger row no code wrote as a file that was not kept, never as a kept address", async () => {
        const policy = await build()

        expect(policy.fileOfKept({ url: 7 }, 2, "file", "a.pdf")).toMatchObject({ id: "unread:store_failed:2", url: "", name: "a.pdf" })
        expect(policy.fileOfKept(null, 0, "image", "")).toMatchObject({ url: "", notKept: "store_failed" })
    })
})
