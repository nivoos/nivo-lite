import { TOOL } from "@nivo-lite/agent-sdk/names"
import { NODE_EFFECT_STORE, INTENT_KIND, type NodeEffectStore } from "@modules/domain/graph-nodes"
import { AGENT_NODE_EFFECTS, memoryEffectStore } from "@tests/fixtures/builders/engine-core-tables.builder"
import { CORE_MOVE_AUTO, CORE_WRITE_AUTO, MONEY_MOVE, NOTE_READ, NOTE_WRITE } from "@tests/fixtures/builders/engine-core-plugin.builder"
import { ANSWER, CONV, UNDERSTAND, actsOf, customerWrites, processOf, redrive, stopsOf, threadDbOf, type ThreadDb, type ThreadProcess } from "./thread-world"
import { coreProcessOf, coreStarted, noteActsOf, threadOf } from "./thread-world-core"

// The customer-line kind (the world's desk) and the plain-write kind (the engine core fixture) installed side by side.
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const desk: typeof import("@tests/fixtures/builders/thread-desk-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/thread-desk-plugin.builder",
    )
    const core: typeof import("@tests/fixtures/builders/engine-core-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/engine-core-plugin.builder",
    )
    return { installed: parts.installationWith([desk.DESK_PLUGIN, core.CORE_PLUGIN], "crash-intent") }
})

// The fixture's plain note write DECLARES `confirmBy` here (a test declaration: a plugin's tool has no core spec to carry one, and the
// one production declaration, the renewal, travels the gateway road its unit spec proves): its read `nivo.tool.test.note.read` answers
// `written: true` when the note is there. Every other spec stays the registry's own.
jest.mock("@modules/domain/tool-specs", () => {
    const actual: typeof import("@modules/domain/tool-specs") = jest.requireActual("@modules/domain/tool-specs")
    const fixture: typeof import("@tests/fixtures/builders/engine-core-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/engine-core-plugin.builder",
    )
    const confirm = {
        tool: fixture.NOTE_READ,
        args: { noteId: { from: "args" as const, member: "noteId" } },
        happened: { member: "written", equals: true },
    }
    return {
        ...actual,
        confirmByOf: (tool: string) => (tool === fixture.NOTE_WRITE ? confirm : actual.confirmByOf(tool)),
        confirmReadsOf: (tool: string) => (tool === fixture.NOTE_WRITE ? [fixture.NOTE_READ] : actual.confirmReadsOf(tool)),
    }
})

// R81-7 (b), QB-P3 rules I-1/I-3: "the api is killed between the provider's accept and the result". The act reaches the outside world
// (its executor acts), and the process dies before the ledger's result is written: the INTENT row stands with no result. A NEW process
// over the same database then re-drives the thread (the sweep), and the step runs from its first line. What happens is what the tool
// DECLARES, never a blind second act: (i) a repeatable tool (the customer send) is made again under the SAME key: its own send ledger
// answers the delivery it already made, one row, one line; (ii) a `confirmBy` write: the declared read is made and settles the row, no
// second act; (iii) a plain write that declares neither (the money-labelled fixture write): ONE stop for a person, no second act.

/** What a process death between the act and its result leaves: a store whose FILL of the target's intent never comes back. */
interface DyingStore {
    /** The store the dying process holds. */
    readonly store: NodeEffectStore
    /** Resolves when the act happened and the process "died" before its result was written. */
    readonly died: Promise<void>
}

/** The world's ledger store, except that filling an intent of `effect` hangs for ever: the process is dead from there on. */
const dyingStoreOf = (db: ThreadDb, effect: string): DyingStore => {
    const inner = memoryEffectStore(db.records)
    let dead = (): void => undefined
    const died = new Promise<void>((resolve) => {
        dead = resolve
    })
    const store: NodeEffectStore = {
        ...inner,
        resettle: async (workspaceId, effectKey, fromKind, subject) => {
            const row = await inner.byKey(workspaceId, effectKey)
            if (fromKind === INTENT_KIND && row?.effectId === effect) {
                dead()
                return new Promise<boolean>(() => undefined)
            }
            return inner.resettle(workspaceId, effectKey, fromKind, subject)
        },
    }
    return { store, died }
}

/** The process extras that make it die after the act of `effect`. */
const dyingExtra = (dying: DyingStore) => [{ provide: NODE_EFFECT_STORE, useValue: dying.store }]

/** A world database whose door's tool road answers the scripted reads and lists every read it was asked (as `engine-core-resume`). */
const scriptedDbOf = (read: unknown): ThreadDb => {
    const db0 = threadDbOf()
    const db: ThreadDb = { ...db0, rights: { ...db0.rights, answers: new Map([[NOTE_READ, [read]]]), asked: [] } }
    return db
}

/** The newest run of the world. */
const newestRunOf = (db: ThreadDb): string => [...db.runs.keys()].at(-1) ?? ""

/** The ledger rows of one effect. */
const ledgerRowsOf = (db: ThreadDb, effect: string) =>
    db.records.of(AGENT_NODE_EFFECTS, { effectId: effect }).map((row) => ({ subject: row.data.subjectEntity, key: row.data.effectKey }))

/** Starts the plain-write fixture graph on a process that dies after the act of `effect`; answers once the process is dead. */
const coreDiedAfterAct = async (db: ThreadDb, graph: string, effect: string): Promise<string> => {
    const dying = dyingStoreOf(db, effect)
    const first = await coreProcessOf(db, { extra: dyingExtra(dying) })
    void coreStarted(first, graph)
    await dying.died
    return newestRunOf(db)
}

describe("R81-7 (b): killed between the act and its result, the plain-write kind", () => {
    it("(iii) a plain write that declares neither repeatable nor confirmBy: the intent stands, the re-drive makes ONE stop, no second act", async () => {
        const db = threadDbOf()
        const runId = await coreDiedAfterAct(db, CORE_MOVE_AUTO, MONEY_MOVE)

        expect(noteActsOf(db).filter((act) => act.effect === MONEY_MOVE)).toHaveLength(1)
        expect(ledgerRowsOf(db, MONEY_MOVE).map((row) => row.subject)).toEqual([INTENT_KIND])

        const second: ThreadProcess = await coreProcessOf(db)
        await redrive(second, runId, "sweep-1")

        const stops = await stopsOf(second, runId)
        expect(stops).toHaveLength(1)
        expect(stops[0]).toMatchObject({ stepKey: "write", state: "open" })
        expect(noteActsOf(db).filter((act) => act.effect === MONEY_MOVE)).toHaveLength(1)
        // The ledger still says nobody knows: only a person settles it.
        expect(ledgerRowsOf(db, MONEY_MOVE).map((row) => row.subject)).toEqual([INTENT_KIND])
    })

    it("(ii) a write that declares confirmBy: the re-drive makes the declared read, the row is settled from it, no second act, the run ends", async () => {
        const db = scriptedDbOf({ written: true })
        const runId = await coreDiedAfterAct(db, CORE_WRITE_AUTO, NOTE_WRITE)
        expect(noteActsOf(db).filter((act) => act.effect === NOTE_WRITE)).toHaveLength(1)

        const second = await coreProcessOf(db)
        await redrive(second, runId, "sweep-1")

        expect((await threadOf(second, runId)).status).toBe("ended")
        expect(await stopsOf(second, runId)).toEqual([])
        expect(noteActsOf(db).filter((act) => act.effect === NOTE_WRITE)).toHaveLength(1)
        expect(db.rights.asked?.filter((call) => call.tool === NOTE_READ).map((call) => call.args)).toEqual([{ noteId: "note-1" }])
        expect(ledgerRowsOf(db, NOTE_WRITE).map((row) => row.subject)).toEqual(["confirmed"])
    })

    it("(ii) the declared read says it did NOT happen: ONE stop for a person, never a second act", async () => {
        const db = scriptedDbOf({ written: false })
        const runId = await coreDiedAfterAct(db, CORE_WRITE_AUTO, NOTE_WRITE)

        const second = await coreProcessOf(db)
        await redrive(second, runId, "sweep-1")

        expect(await stopsOf(second, runId)).toHaveLength(1)
        expect(noteActsOf(db).filter((act) => act.effect === NOTE_WRITE)).toHaveLength(1)
        expect(ledgerRowsOf(db, NOTE_WRITE).map((row) => row.subject)).toEqual([INTENT_KIND])
    })
})

const REPLY = "Shop mo cua tu 8h den 21h a."
const sends = (text: string) => ({ call: { tool: TOOL.customerMessageSend, args: { conversationId: CONV, text } } })

describe("R81-7 (b): killed between the act and its result, the customer-line kind", () => {
    it("(i) the customer send (repeatable): the re-drive sends again under the SAME key; its send ledger answers: ONE row, ONE line", async () => {
        const db = threadDbOf()
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Lan: gio mo cua" } })
        db.model.script(ANSWER, sends(REPLY), { done: { reply: REPLY } }, sends(REPLY), { done: { reply: REPLY } })
        const dying = dyingStoreOf(db, TOOL.customerMessageSend)
        const first = await processOf(db, { extra: dyingExtra(dying) })
        void customerWrites(first, "Shop mo cua may gio?")
        await dying.died
        const runId = newestRunOf(db)
        expect(ledgerRowsOf(db, TOOL.customerMessageSend).map((row) => row.subject)).toEqual([INTENT_KIND])
        expect(db.chat.ledger.rows.map((row) => [row.text, row.state])).toEqual([[REPLY, "delivered"]])

        const second = await processOf(db)
        await redrive(second, runId, "sweep-1")

        expect(await stopsOf(second, runId)).toEqual([])
        // The same key: the send ledger's row answers what it delivered; the channel is not asked twice.
        expect(db.chat.ledger.rows.map((row) => [row.text, row.state])).toEqual([[REPLY, "delivered"]])
        // The send was asked again (it declares itself repeatable), under the SAME key as the first.
        const keys = actsOf(db, TOOL.customerMessageSend).map((act) => act.key)
        expect(keys).toHaveLength(2)
        expect(new Set(keys).size).toBe(1)
        expect(ledgerRowsOf(db, TOOL.customerMessageSend).map((row) => row.subject)).not.toContain(INTENT_KIND)
    })
})
