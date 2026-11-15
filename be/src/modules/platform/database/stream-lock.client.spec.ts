import { mockEntityManager } from "@starci/jest-preset"
import { HASH_STATEMENT, LOCK_HASH, LOCK_STATEMENT, advisoryLockAnswers } from "@tests/fixtures/builders/advisory-lock.builder"
import { lockStreamSubject } from "./stream-lock.client"

// Concept agent-data rule 12: one lock per (workspace, stream, subject), taken in the CALLER's transaction before the append.

describe("lockStreamSubject", () => {
    it("locks the subject of one stream of one workspace in the caller's transaction", async () => {
        const manager = mockEntityManager({ query: advisoryLockAnswers })

        await lockStreamSubject(manager, "ws-1", "lines", "route-7")

        expect(manager.query).toHaveBeenNthCalledWith(1, HASH_STATEMENT, ["stream:ws-1:lines:route-7", 0])
        expect(manager.query).toHaveBeenNthCalledWith(2, LOCK_STATEMENT, [LOCK_HASH])
    })

    it("gives every stream and subject its own key (a record type's subject never shares a route's lock)", async () => {
        const manager = mockEntityManager({ query: advisoryLockAnswers })

        await lockStreamSubject(manager, "ws-1", "fixture-web.webrenew.renewal-note", "svc-1")

        expect(manager.query).toHaveBeenNthCalledWith(1, HASH_STATEMENT, ["stream:ws-1:fixture-web.webrenew.renewal-note:svc-1", 0])
    })
})
