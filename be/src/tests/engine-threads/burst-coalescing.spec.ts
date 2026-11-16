import { AgentGraphRunQueueService } from "@modules/domain/agent-graphs/agent-graph-run-queue.service"
import { AGENT_NODE_EFFECTS, AGENT_RUNS } from "@tests/fixtures/builders/engine-core-tables.builder"
import { holdProvidersOf } from "./thread-world-core"
import { UNDERSTAND, customersSay, processOf, runTurns, threadDbOf, type ThreadProcess } from "./thread-world"

// WORLD (a) of the backlog: a burst of customer lines is ONE run (coordinator ruling 3 of the one event pipeline, final rule: one run per
// (graph, subject)). Since rule Q-4 (QB-P5): the Zalo line declares `combine: "stream"`, so the burst is ONE stream MARKER at delivery: the
// OLDEST wake stays (count 3, the newest event named), the later ones close `coalesced:<marker>` and begin nothing; the run's trigger is the
// oldest line plus `since` and `count`, its queue takes nothing, and the words are read from the stream (hear reads the unread lines). THE
// TWO HALVES:
//
//  - PROVED HERE: the customer lines come in through the real Zalo entry (the body kept once, the provider's pure `translate`, the REAL
//    `ProviderTriggersService.deliver`: contact met, route ensured, the registration asked, one wake per line). The settle time is the one
//    the Zalo declaration declares (`ZALO_MESSAGE_TRIGGER.settle`: 6 s window, 20 s at most), stamped on each wake by the REAL `burstFor`.
//    The oldest wake begins ONE run; the REAL run queue takes the later wakes of the same lock scope on the run's first step visit, as a
//    snapshot kept once in the effect ledger (`queue:<run>:<step>:<visit>`); a line of another route is another scope and its own run.
//  - NOT PROVED HERE (a memory world has no database clock and no `agent_wakes` table): that `agent_turn_begin` itself waits the sliding
//    settle window before it begins the oldest wake and stops at the cap. That is the migration
//    `db/migrations/20261114000000_burst-merge-lines.sql` and `be/src/tests/integration/agent-work/agent-work-store.integration-spec.ts`
//    (written, NOT run by this lane: it needs a database). The old merge model (`mergedLinesJson`, `isStart`, a barrier at a `/start`) is gone
//    with the design; a `/start` is an ordinary line now (Opus-2), the hand-back is world (l).

/** A customer other than the world's default one: a Zalo user id is digits. */
const OTHER = "8800110033"

/** A moment of the channel, in the order the customer sent the lines: one second apart. */
const SENT = Date.parse("2026-11-10T10:00:00.000Z")
const at = (second: number): Date => new Date(SENT + second * 1000)

/** The queue snapshots the run kept, by ledger key. */
const snapshotsOf = (db: ThreadProcess["db"], runId: string): ReadonlyArray<{ key: string; events: ReadonlyArray<{ wakeId: string; scope: Record<string, unknown> }> }> =>
    db.records
        .of(AGENT_NODE_EFFECTS, { runId })
        .filter((row) => String(row.data.effectKey).startsWith(`queue:${runId}:`))
        .map((row) => ({
            key: String(row.data.effectKey),
            events: ((row.data.args as { events?: Array<{ wakeId: string; scope: Record<string, unknown> }> } | null)?.events ?? []),
        }))

/** The step keys of a run, in order. */
const stepsOf = async (process: ThreadProcess, runId: string): Promise<ReadonlyArray<string>> => {
    const view = await process.threads.stateOf({ workspaceId: process.db.records.get(AGENT_RUNS, runId)?.workspaceId ?? "", runId })
    return Object.keys(view?.state.steps ?? {})
}

/** The `buy` branch of the front desk: it hands on to Sales and tells the customer nothing (the walk's shortest route). */
const buy = (db: ThreadProcess["db"], times = 1): void => {
    for (let one = 0; one < times; one += 1) db.model.script(UNDERSTAND, { done: { branch: "buy", summary: "Lan: buy" } })
}

describe("burst: three lines one second apart on one route are ONE run (one stream marker: the oldest, count 3)", () => {
    it("one run for three lines; the later wakes close behind the oldest at delivery and begin nothing; the run's trigger counts them", async () => {
        const db = threadDbOf()
        buy(db)
        const process = await processOf(db, { extra: [...holdProvidersOf(db), AgentGraphRunQueueService] })

        const wakes = await customersSay(process, [
            { text: "Shop oi", key: "m-b1", at: at(0) },
            { text: "cho minh dat hoa", key: "m-b2", at: at(1) },
            { text: "mot bo hong do nhe", key: "m-b3", at: at(2) },
        ])
        expect(wakes).toHaveLength(3)
        // One lock scope for the person; the wake door stamped the settle time the Zalo declaration declares on every one of them.
        expect(new Set(wakes.map((wake) => wake.scopeKey)).size).toBe(1)
        expect(wakes.map((wake) => wake.burst)).toEqual(Array(3).fill({ windowMs: 6000, maxWaitMs: 20_000 }))
        // ONE marker at delivery (rule Q-4 stream): the oldest stays pending with the count and the newest event; the others are closed.
        const markerId = wakes[0]?.id ?? ""
        expect(wakes.map((wake) => wake.state)).toEqual(["pending", "queued", "queued"])
        expect(wakes.map((wake) => wake.reason ?? null)).toEqual([null, `coalesced:${markerId}`, `coalesced:${markerId}`])
        expect(wakes[0]?.context).toMatchObject({ combine: "stream", eventId: "m-b1", count: "3", latestEventId: "m-b3" })

        const woken = await runTurns(process, wakes)

        // ONE run; the two later wakes ran no run of their own.
        expect(woken).toHaveLength(1)
        expect(woken[0]?.error).toBeNull()
        expect(woken[0]?.ending).toMatchObject({ status: "done" })
        expect([...db.runs.keys()]).toHaveLength(1)
        const runId = woken[0]?.runId ?? ""
        expect(wakes.map((wake) => wake.state)).toEqual(["begun", "queued", "queued"])
        // The trigger is the OLDEST line (R74 item 6) with `since` and `count`; the queue of the first visit takes nothing (nothing pending).
        const view = await process.threads.stateOf({ workspaceId: db.records.get(AGENT_RUNS, runId)?.workspaceId ?? "", runId })
        const trigger = (view?.state as { trigger?: { data?: { text?: string }; count?: number; since?: string } } | undefined)?.trigger
        expect(trigger?.data?.text).toBe("Shop oi")
        expect(trigger?.count).toBe(3)
        expect(typeof trigger?.since).toBe("string")
        expect((await stepsOf(process, runId))[0]).toBe("hear")
        expect(snapshotsOf(db, runId).flatMap((one) => one.events)).toEqual([])
    })

    it("a line of ANOTHER route in the same window is its own run: another lock scope, never folded into the first person's marker", async () => {
        const db = threadDbOf()
        buy(db, 2)
        const process = await processOf(db, { extra: [...holdProvidersOf(db), AgentGraphRunQueueService] })

        const wakes = await customersSay(process, [
            { text: "Shop oi", key: "m-c1", at: at(0) },
            { text: "Em la khach moi", key: "m-o1", userId: OTHER, visitor: "Mai", at: at(1) },
            { text: "cho minh dat hoa", key: "m-c2", at: at(2) },
        ])
        expect(new Set(wakes.map((wake) => wake.scopeKey)).size).toBe(2)
        expect(wakes.map((wake) => wake.reason ?? null)).toEqual([null, null, `coalesced:${wakes[0]?.id ?? ""}`])

        const woken = await runTurns(process, wakes)

        expect(woken.map((one) => one.error)).toEqual([null, null])
        expect([...db.runs.keys()]).toHaveLength(2)
        const [mine, other] = woken
        expect(snapshotsOf(db, mine?.runId ?? "").flatMap((one) => one.events)).toEqual([])
        expect(snapshotsOf(db, other?.runId ?? "").flatMap((one) => one.events)).toEqual([])
        expect(wakes.map((wake) => wake.state)).toEqual(["begun", "begun", "queued"])
    })

    it("the same line delivered twice is one wake and one run (the account keeps the event once)", async () => {
        const db = threadDbOf()
        buy(db)
        const process = await processOf(db, { extra: [...holdProvidersOf(db), AgentGraphRunQueueService] })

        const first = await customersSay(process, [{ text: "Shop oi", key: "m-d1", at: at(0) }])
        const again = await customersSay(process, [{ text: "Shop oi", key: "m-d1", at: at(0) }])

        expect(first).toHaveLength(1)
        expect(again).toEqual([])
        const woken = await runTurns(process, first)
        expect(woken).toHaveLength(1)
        expect([...db.runs.keys()]).toHaveLength(1)
    })
})
