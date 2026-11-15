import { createHash } from "node:crypto"
import type { EntityManager } from "typeorm"
import type { CellSourceInput, ValidatedCell, ValidatedGraph } from "@modules/domain/cells"
import { fakeQueryBuilder, type QueryBuilderAnswers } from "./entity-query-builder.builder"

/*
 * Doubles and fixture rows of the cells storage (slice S1). The rows are the two fixture kinds of CELLS-PLAN 9.3: `demo-money` (an outside write that is
 * not repeatable, settled by a read) and `demo-crm-lead` (a repeatable outside write, a loop over leads, workflow variables).
 */

/** The text of the stored source of `demo.ask-to-pay`. */
export const ASK_TO_PAY_SOURCE = "export default async (ctx) => ({ asked: ctx.input.amount })"

/** The text of the stored source of `demo.file-lead`. */
export const FILE_LEAD_SOURCE = "export default async (ctx) => ({ filed: ctx.input.lead })"

/** The source input of a text, written by a package. */
export const packageSourceOf = (text: string): CellSourceInput => ({
    text,
    authorKind: "package",
    authorRef: "demo-pkg",
})

/** The node `demo.ask-to-pay` of `demo-money`: stored source, an outside non-repeatable write settled by a read. */
export const askToPayNode = (source: { readonly id: string; readonly sha256: string }): ValidatedCell => ({
    kind: "node",
    key: "demo.ask-to-pay",
    version: 1,
    title: { vi: "Yeu cau thanh toan", en: "Ask to pay" },
    inputSchema: { type: "object", properties: { amount: { type: "integer" } }, required: ["amount"] },
    outputSchema: { type: "object", properties: { asked: { type: "integer" } } },
    configSchema: { type: "object" },
    semantics: {
        mutates: true,
        outside: true,
        refusals: ["amount_too_small"],
        tools: ["nivo.tool.payment.request.create", "nivo.tool.customer.message.send"],
    },
    body: { entry: "run" },
    source,
    examples: [{ name: "asks", input: { amount: 100 }, expect: { ok: { asked: 100 } } }],
    reviewState: "approved",
    reviewRef: "demo-money@aaaa",
})

/** The node `demo.file-lead` of `demo-crm-lead`: stored source, a repeatable outside write. */
export const fileLeadNode = (source: { readonly id: string; readonly sha256: string }): ValidatedCell => ({
    kind: "node",
    key: "demo.file-lead",
    version: 1,
    title: { vi: "Nop lead", en: "File lead" },
    inputSchema: { type: "object", properties: { lead: { type: "object" } } },
    outputSchema: { type: "object" },
    configSchema: { type: "object" },
    semantics: { mutates: true, outside: true, repeatable: true, tools: ["nivo.tool.crm.lead.create"] },
    body: { entry: "run" },
    source,
    examples: [],
    reviewState: "approved",
    reviewRef: "demo-crm-lead@bbbb",
})

/** The tool `nivo.tool.payment.request.read` of `demo-money`: a read with no source. */
export const paymentReadTool = (): ValidatedCell => ({
    kind: "tool",
    key: "nivo.tool.payment.request.read",
    version: 1,
    title: { vi: "Doc yeu cau", en: "Read request" },
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    configSchema: { type: "object" },
    semantics: { mutates: false },
    body: {},
    source: null,
    examples: [],
    reviewState: "approved",
    reviewRef: "demo-money@aaaa",
})

/** The graph `demo.payment` of `demo-money`: a `core.if` match, then the node. */
export const paymentGraph = (): ValidatedGraph => ({
    key: "demo.payment",
    version: 1,
    document: {
        start: "match",
        triggers: [{ trigger: "demo.bank-credit" }],
        steps: {
            match: { kind: "core.if", when: { op: "present", ref: { $ref: "trigger.amount" } }, yes: "ask" },
            ask: {
                kind: "node",
                cell: { kind: "node", key: "demo.ask-to-pay", version: 1 },
                input: { amount: { $ref: "trigger.amount" } },
                mode: "auto",
                accounts: [],
            },
        },
    },
    reviewState: "approved",
    reviewRef: "demo-money@aaaa",
})

/** The graph `demo.lead-intake` of `demo-crm-lead`: a loop over leads, the node inside, and the `vars` declaration (CELLS-DECISIONS D1). */
export const leadIntakeGraph = (): ValidatedGraph => ({
    key: "demo.lead-intake",
    version: 1,
    document: {
        start: "each",
        triggers: [{ trigger: "nivo.trigger.manual" }],
        steps: {
            each: { kind: "core.loop", config: { over: { $ref: "trigger.leads" }, body: "file" } },
            file: {
                kind: "node",
                cell: { kind: "node", key: "demo.file-lead", version: 1 },
                input: { lead: { $ref: "item" } },
                mode: "auto",
                accounts: [],
                next: "count",
            },
            count: { kind: "core.set", config: { set: { filed: { $ref: "steps.file.output.filed" } } } },
        },
        vars: {
            filed: { schema: { type: "object" } },
            leads: { schema: { type: "array" }, merge: "append" },
        },
    },
    reviewState: "approved",
    reviewRef: "demo-crm-lead@bbbb",
})

/** The sha256 of a fixture source text. */
export const sourceHashOf = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex")

type Row = Record<string, unknown>
type Target = { readonly name: string; readonly prototype: object }

const isManager = (_value: MemoryCellsManager): _value is MemoryCellsManager & EntityManager => true
const isObject = (_value: unknown): _value is object => true
const asRow = (value: object): Row => Object.fromEntries(Object.entries(value))

/** Evaluates a value the way the database would: a function expression (`() => "now()"`) is the current time. */
const stamped = (value: unknown): unknown =>
    typeof value === "function" ? new Date("2026-11-15T00:00:00.000Z") : value

const ENTITY_DEFAULTS: Readonly<Record<string, Row>> = {
    CellDefinitionEntity: { deletedAt: null, reviewRef: null, publishedAt: null },
    CellGraphEntity: { deletedAt: null, reviewRef: null, publishedAt: null },
    CellPackageEntity: { deletedAt: null },
}

/**
 * An entity manager over memory for the cells entities: `findOne`, `findOneByOrFail`, `insert`, `save`, `update`, `exists` and a scripted
 * `createQueryBuilder`. It keeps no trigger: the database refusal is proven on a throwaway Postgres, not here. It counts reads, so a spec can show
 * that a cache answered without the database.
 */
export class MemoryCellsManager {
    /** How many `findOne` / `findOneByOrFail` reads reached it, per entity name. */
    readonly reads: Record<string, number> = {}
    /** The query-builder doubles `createQueryBuilder` hands out, in order. */
    readonly builders: Array<ReturnType<typeof fakeQueryBuilder>> = []
    private readonly tables = new Map<string, Array<Row>>()
    private readonly pending: Array<ReturnType<typeof fakeQueryBuilder>> = []

    /** The rows of an entity, as kept. */
    rowsOf(target: Target): Array<Row> {
        const rows = this.tables.get(target.name) ?? []
        this.tables.set(target.name, rows)
        return rows
    }

    /** Queues the answer of the next `createQueryBuilder`. */
    queueBuilder(answers: QueryBuilderAnswers): void {
        this.pending.push(fakeQueryBuilder(answers))
    }

    /** The manager the services take (this double stands in for the whole `EntityManager`; the one place that says so to the type system). */
    manager(): EntityManager {
        if (!isManager(this)) throw new Error("not a manager")
        return this
    }

    findOne(target: Target, options: { readonly where: Row }): Promise<object | null> {
        this.reads[target.name] = (this.reads[target.name] ?? 0) + 1
        const row = this.rowsOf(target).find((candidate) =>
            Object.entries(options.where).every(([member, value]) => candidate[member] === value),
        )
        return Promise.resolve(row === undefined ? null : Object.assign(Object.create(target.prototype), row))
    }

    async findOneByOrFail(target: Target, where: Row): Promise<object> {
        const row = await this.findOne(target, { where })
        if (row === null) throw new Error(`no ${target.name}`)
        return row
    }

    /** The rows matching `where`; `order: { createdAt: "DESC" }` is insertion order reversed (rows are added in time order), `take` keeps the first ones. */
    find(
        target: Target,
        options: { readonly where: Row; readonly order?: Row; readonly take?: number },
    ): Promise<ReadonlyArray<object>> {
        const matching = this.rowsOf(target).filter((candidate) =>
            Object.entries(options.where).every(([member, value]) => candidate[member] === value),
        )
        const ordered = options.order?.createdAt === "DESC" ? [...matching].reverse() : matching
        return Promise.resolve(
            ordered
                .slice(0, options.take ?? ordered.length)
                .map((row) => Object.assign(Object.create(target.prototype), row)),
        )
    }

    exists(target: Target, options: { readonly where: Row }): Promise<boolean> {
        const hit = this.rowsOf(target).some((candidate) =>
            Object.entries(options.where).every(([member, value]) => candidate[member] === value),
        )
        return Promise.resolve(hit)
    }

    insert(target: Target, values: object): Promise<{ readonly identifiers: ReadonlyArray<{ readonly id: string }> }> {
        return Promise.resolve({ identifiers: [{ id: this.add(target, values).id as string }] })
    }

    /** `save(Entity, values)` inserts; `save(entityInstance)` inserts a new instance or writes an instance read earlier back over its row (the class names the table). */
    save(targetOrEntity: Target | object, values?: object): Promise<object> {
        if (values !== undefined && "name" in targetOrEntity && "prototype" in targetOrEntity)
            return Promise.resolve(this.add(targetOrEntity, values))
        const target = { name: targetOrEntity.constructor.name, prototype: targetOrEntity.constructor.prototype }
        const kept = this.rowsOf(target).find(
            (candidate) => "id" in targetOrEntity && candidate.id === targetOrEntity.id,
        )
        if (kept === undefined) return Promise.resolve(this.add(target, targetOrEntity))
        for (const [member, value] of Object.entries(targetOrEntity))
            if (value !== undefined) kept[member] = stamped(value)
        return Promise.resolve(kept)
    }

    update(target: Target, criteria: { readonly id: string }, patch: object): Promise<void> {
        const row = this.rowsOf(target).find((candidate) => candidate.id === criteria.id)
        if (row !== undefined) for (const [member, value] of Object.entries(patch)) row[member] = stamped(value)
        return Promise.resolve()
    }

    createQueryBuilder(): object {
        const next = this.pending.shift()
        if (next === undefined) throw new Error("no query builder queued")
        this.builders.push(next)
        return next.builder
    }

    private add(target: Target, values: object): Row {
        const rows = this.rowsOf(target)
        const row: Row = { id: `${target.name}-${String(rows.length + 1)}`, ...ENTITY_DEFAULTS[target.name] }
        for (const [member, value] of Object.entries(asRow(isObject(values) ? values : {})))
            if (value !== undefined) row[member] = stamped(value)
        rows.push(row)
        return row
    }
}
