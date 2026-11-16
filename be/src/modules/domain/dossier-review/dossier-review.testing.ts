import { fakeTransaction, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { SRC, WS } from "@tests/fixtures/builders/dossier-review-world.builder"
import { DossierReviewRunEntity } from "./persistence/entities"

/** A run row the spec keeps: `update` applies its changes when the where matches (a status, or one of a list), `findOne` answers it. */
export const runStore = (initial: DossierReviewRunEntity["status"] = "queued") => {
    const run = Object.assign(new DossierReviewRunEntity(), {
        id: "r1",
        workspaceId: WS,
        scope: "workspace",
        dossierId: null,
        trigger: "document",
        triggerRef: SRC,
        status: initial,
        requestedBy: null,
        aiState: null,
        stats: {},
        error: null,
        startedAt: null,
        finishedAt: null,
    })
    const em: MockEntityManager = mockEntityManager()
    fakeTransaction(em)
    em.findOne.mockImplementation(() => Promise.resolve(run))
    em.update.mockImplementation((_entity: unknown, where: Record<string, unknown>, changes: Record<string, unknown>) => {
        const wanted = where.status
        const list: ReadonlyArray<unknown> | undefined =
            typeof wanted === "object" && wanted !== null && "value" in wanted && Array.isArray(wanted.value) ? wanted.value : undefined
        const matches = wanted === undefined || (list === undefined ? wanted === run.status : list.includes(run.status))
        if (matches && (where.error === undefined || where.error === run.error)) Object.assign(run, changes)
        return Promise.resolve({ affected: matches ? 1 : 0, raw: [], generatedMaps: [] })
    })
    return { run, em }
}
