import { Injectable } from "@nestjs/common"
import { isRecord } from "@modules/platform/primitives"
import {
    OPENAPI_PROVIDER,
    REPLAY_KEY_HEADER,
    canonicalJsonOf,
    responseSchemaOf,
    takesReplayKey,
    type AccountBase,
    type AccountKey,
    type PinnedDocument,
    type PinnedOperation,
    type SchemaNode,
} from "@modules/domain/openapi-tools"
import {
    NEXT_CASE_STATE,
    ProviderSandboxError,
    ProviderSandboxErrorCode,
    ProviderSandboxService,
    type SandboxState,
} from "@modules/domain/provider-sandbox"
import {
    OPENAPI_CALL_OPERATION,
    OPENAPI_SANDBOX_CASE,
    OPENAPI_SANDBOX_FAILURE_STATUS,
    OPENAPI_SANDBOX_NOT_FOUND_STATUS,
    OPENAPI_SANDBOX_REFUSAL_STATUS,
    OPENAPI_SANDBOX_SLOW_MS,
    OPENAPI_SANDBOX_TIMEOUT_STATUS,
} from "./openapi-sandbox.catalogue"
import { OpenApiSandboxTimeoutError } from "./openapi-sandbox-faults"
import type { OpenApiSandboxFixtures, OpenApiSandboxOperationFixture } from "./openapi-sandbox-fixtures.contracts"
import { OpenApiSandboxFixturesRegistryService } from "./openapi-sandbox-fixtures-registry.service"
import {
    childrenOf,
    collectionsOf,
    declaredKeysOf,
    filteredOf,
    generatedKeyOf,
    keyMembersOf,
    keyTextOf,
    lentOf,
    listMemberOf,
    resourceOf,
    reusedRecordOf,
    shapedOf,
    startingRecordsOf,
    successSchemaOf,
    successStatusOf,
    type SandboxResource,
} from "./openapi-sandbox-store.policy"
import type { OpenApiReachAccount, OpenApiReachAnswer, OpenApiReachCall, OpenApiReachPort } from "./openapi-reach.contracts"

/** The value a sandbox account's "key" carries: no secret exists for a sandbox account; the call never leaves the process. */
export const OPENAPI_SANDBOX_KEY_VALUE = "sandbox"

/** A record of the store. */
type Row = Readonly<Record<string, unknown>>

/** The state name a kept record of a collection lives under (key = the record's key). */
const recordState = (collection: string): string => `record:${collection}`

/** The state name of the keys a collection kept, in the order they were kept (key `""`). */
const indexState = (collection: string): string => `records:${collection}`

/** The state name of the running number of a collection's generated keys (key = the collection). */
const IDS_STATE = "ids"

/** The state name of the answers kept under a replay key, by operation id (key = the replay key). */
const replayState = (operationId: string): string => `replay:${operationId}`

/** The status a replay key used with another request is refused with (the key belongs to the first request). */
const REPLAY_KEY_REUSED_STATUS = 409

/** The replay key a call carries (the header the provider fills itself), or null. */
const replayKeyOf = (input: Readonly<Record<string, unknown>>): string | null => {
    const found = Object.entries(input).find(([name]) => name.toLowerCase() === REPLAY_KEY_HEADER)
    return typeof found?.[1] === "string" && found[1] !== "" ? found[1] : null
}

/** What a replay key is bound to: the call's request without the key itself. */
const requestTextOf = (input: Readonly<Record<string, unknown>>): string =>
    canonicalJsonOf(Object.fromEntries(Object.entries(input).filter(([name]) => name.toLowerCase() !== REPLAY_KEY_HEADER)))

/** The state name that says the account's store holds the package's starting records (key `""`). */
const SEEDED_STATE = "seeded"

/** A JSON object, or an empty one. */
const objectOf = (value: unknown): Row => (isRecord(value) ? value : {})

/** The keys a collection kept (empty for a new account). */
const keptKeysOf = (kept: unknown): ReadonlyArray<string> => (Array.isArray(kept) ? kept.filter((one): one is string => typeof one === "string") : [])

/** One answer of a status and a JSON body (no body for an answer the document declares without one). */
const answerOf = (status: number, body: unknown): OpenApiReachAnswer => ({ status, text: body === undefined ? "" : JSON.stringify(body) })

/** The case ids of the catalogue. */
const CASE_IDS: ReadonlySet<string> = new Set(Object.values(OPENAPI_SANDBOX_CASE))

/** A kept next case when it is one of the catalogue's, else null. */
const caseOf = (value: unknown): string | null => (typeof value === "string" && CASE_IDS.has(value) ? value : null)

/** A pause of the slow case (the lock of the account is held: its calls answer one after the other, as a slow system would). */
const pause = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms)
    })

/** What the sandbox of one connector derives from its document and declarations, once. */
interface ConnectorModel {
    readonly document: PinnedDocument
    readonly fixtures: Readonly<Record<string, OpenApiSandboxOperationFixture>>
    readonly operations: ReadonlyMap<string, PinnedOperation>
    readonly keys: ReadonlyMap<string, string>
    readonly collections: ReadonlyArray<string>
    readonly starting: ReadonlyMap<string, ReadonlyArray<Row>>
}

/** The model of a connector's sandbox, from what the package registered. */
const modelOf = (registered: OpenApiSandboxFixtures, document: PinnedDocument): ConnectorModel => {
    const starting = startingRecordsOf(registered.operations)
    const keys = new Map([...declaredKeysOf(registered.operations), ...keyMembersOf(document)])
    return {
        document,
        fixtures: registered.operations,
        operations: new Map([...document.operations.values()].map((operation) => [operation.operationId, operation])),
        keys,
        collections: [...new Set([...collectionsOf(document), ...starting.keys(), ...keys.keys()])],
        starting,
    }
}

/** The account's store of one call: the kept records of every collection, read and written through the frame's state (under its lock). */
class AccountStore {
    constructor(
        private readonly state: SandboxState,
        private readonly accountId: string,
        private readonly model: ConnectorModel,
    ) {}

    /** Writes the package's starting records once per account (again after the account is reset: its state is gone). */
    async seeded(): Promise<void> {
        if ((await this.state.read(SEEDED_STATE, "")) === true) return
        for (const [collection, records] of this.model.starting) {
            for (const record of records) {
                const member = this.model.keys.get(collection)
                const key = (member === undefined ? null : keyTextOf(record[member])) ?? (await this.nextKey(collection))
                await this.put(collection, key, record)
            }
        }
        await this.state.write(SEEDED_STATE, "", true)
    }

    async records(collection: string): Promise<ReadonlyArray<Row>> {
        const keys = keptKeysOf(await this.state.read(indexState(collection), ""))
        const records = await Promise.all(keys.map((key) => this.get(collection, key)))
        return records.filter((record): record is Row => record !== null)
    }

    async get(collection: string, key: string): Promise<Row | null> {
        const kept = await this.state.read(recordState(collection), key)
        return isRecord(kept) ? kept : null
    }

    async put(collection: string, key: string, record: Row): Promise<void> {
        await this.state.write(recordState(collection), key, record)
        const keys = keptKeysOf(await this.state.read(indexState(collection), ""))
        if (!keys.includes(key)) await this.state.write(indexState(collection), "", [...keys, key])
    }

    async remove(collection: string, key: string): Promise<void> {
        await this.state.write(recordState(collection), key, null)
        const keys = keptKeysOf(await this.state.read(indexState(collection), ""))
        await this.state.write(indexState(collection), "", keys.filter((one) => one !== key))
    }

    /** The next generated key of a collection (a running number per account and collection, under the account's lock). */
    async nextKey(collection: string): Promise<string> {
        const kept = await this.state.read(IDS_STATE, collection)
        const n = (typeof kept === "number" ? kept : 0) + 1
        await this.state.write(IDS_STATE, collection, n)
        return generatedKeyOf(this.accountId, collection, n)
    }

    /** The records the members name: a text member that is the key of a record of another keyed collection. */
    async referencesOf(members: Row, own: string): Promise<ReadonlyArray<Row>> {
        const texts = [...new Set(Object.values(members).flatMap((value) => (typeof value === "string" && value !== "" ? [value] : [])))]
        const found: Array<Row> = []
        for (const [collection] of this.model.keys) {
            if (collection === own) continue
            for (const text of texts) {
                const record = await this.get(collection, text)
                if (record !== null) found.push(record)
            }
        }
        return found
    }
}

@Injectable()
/**
 * The SANDBOX reach of an API account (the OpenAPI provider's port for a sandbox account): it never reaches a host, holds no key and
 * answers EVERY operation of the document the package pins, GENERICALLY (R75: operation ids, collections and members are the document's
 * and the package's data, never a system's noun): a stateful store per account (`openapi-sandbox-store.policy`): create, list, read,
 * update, act, remove by collection, keys generated under the account's lock, every answer shaped by the document's own schemas, the
 * store started with the records the package declares. The account's NEXT CASE picks the outcome (R62; picked for one operation by its
 * operation id as the scope, else for every call `call`; `OPENAPI-1` by default): the store's answer, a refusal (the package's own 4xx of
 * the operation, else 422, nothing applied), a failure (its own 5xx, else 503, nothing applied), an applied write whose answer is lost
 * (504), a request lost before it applied (a timeout), a slow answer. An operation the document declares takes the replay key answers a
 * repeated key with its kept result (the system's idempotency contract). One logged call per request, under its operation id.
 */
export class OpenApiSandboxReachService implements OpenApiReachPort {
    readonly provider = OPENAPI_PROVIDER

    private readonly models = new Map<string, ConnectorModel>()

    constructor(
        private readonly sandbox: ProviderSandboxService,
        private readonly fixtures: OpenApiSandboxFixturesRegistryService,
    ) {}

    /** No host is reached: nothing to refuse (a live account, or the sandbox off, is refused). */
    async reachable(account: OpenApiReachAccount, _base: AccountBase): Promise<void> {
        await Promise.resolve()
        this.sandbox.assertOpen(account)
    }

    /** The account's stand-in key: a sandbox account holds no secret, and the call never leaves the process. */
    async keyOf(account: OpenApiReachAccount, base: AccountBase): Promise<AccountKey | null> {
        await Promise.resolve()
        this.sandbox.assertOpen(account)
        return { type: base.authType, name: base.authName, value: OPENAPI_SANDBOX_KEY_VALUE }
    }

    /** No live document: the pinned one stands (a live account, or the sandbox off, is refused). */
    async liveDocument(account: OpenApiReachAccount, _url: string): Promise<string | null> {
        await Promise.resolve()
        this.sandbox.assertOpen(account)
        return null
    }

    /** Answers one call from the account's next case and store; one logged call under the operation id. */
    call(account: OpenApiReachAccount, call: OpenApiReachCall): Promise<OpenApiReachAnswer> {
        return this.sandbox.call(
            account,
            call.operationId,
            { connector: account.connector, operationId: call.operationId, method: call.method, path: call.path, input: call.input },
            {
                key: call.operationId,
                answer: async (state) => {
                    const picked = caseOf(state.nextCase) ?? caseOf(await state.read(NEXT_CASE_STATE, OPENAPI_CALL_OPERATION))
                    const model = this.modelOf(account.connector, call.operationId)
                    const operation = this.operationOf(model, account.connector, call.operationId)
                    const fixture = model.fixtures[call.operationId]
                    if (picked === OPENAPI_SANDBOX_CASE.refused) return this.refusedOf(operation, fixture)
                    if (picked === OPENAPI_SANDBOX_CASE.failed) return this.failedOf(operation, fixture)
                    if (picked === OPENAPI_SANDBOX_CASE.lost) throw new OpenApiSandboxTimeoutError()
                    if (picked === OPENAPI_SANDBOX_CASE.slow) await pause(OPENAPI_SANDBOX_SLOW_MS)
                    const store = new AccountStore(state, account.id, model)
                    await store.seeded()
                    const answer = await this.replayed(state, operation, call, () => this.answered(store, model, operation, fixture, call))
                    if (picked === OPENAPI_SANDBOX_CASE.timedOut) {
                        return answerOf(OPENAPI_SANDBOX_TIMEOUT_STATUS, { code: "timeout", message: "answer lost by the sandbox case OPENAPI-4" })
                    }
                    return answer
                },
            },
        )
    }

    /**
     * The answer of an operation whose document declares the replay key (`takesReplayKey`): a key answered before answers its kept result
     * again and acts nothing (the system's contract the engine's `repeatable` relies on); the same key with another request is refused 409
     * `idempotency_key_reused`; a new key acts and keeps a 2xx answer under it. Any other operation acts every time.
     */
    private async replayed(
        state: SandboxState,
        operation: PinnedOperation,
        call: OpenApiReachCall,
        act: () => Promise<OpenApiReachAnswer>,
    ): Promise<OpenApiReachAnswer> {
        const key = takesReplayKey(operation) ? replayKeyOf(call.input) : null
        if (key === null) return act()
        const request = requestTextOf(call.input)
        const kept = objectOf(await state.read(replayState(call.operationId), key))
        if (typeof kept["request"] === "string") {
            if (kept["request"] !== request) {
                return this.problemOf(operation, REPLAY_KEY_REUSED_STATUS, "idempotency_key_reused", "the replay key was first used with another request")
            }
            const status = kept["status"]
            const text = kept["text"]
            if (typeof status === "number" && typeof text === "string") return { status, text }
        }
        const answer = await act()
        if (answer.status >= 200 && answer.status < 300) {
            await state.write(replayState(call.operationId), key, { request, status: answer.status, text: answer.text })
        }
        return answer
    }

    /** The model of a connector's sandbox; a connector no package pins a readable document for names the gap. */
    private modelOf(connector: string, operationId: string): ConnectorModel {
        const kept = this.models.get(connector)
        if (kept !== undefined) return kept
        const registered = this.fixtures.of(connector)
        if (registered?.document === undefined || registered.document === null) {
            throw new ProviderSandboxError({ code: ProviderSandboxErrorCode.CaseUnknown, params: { caseId: `${connector}:${operationId}` } })
        }
        const model = modelOf(registered, registered.document)
        this.models.set(connector, model)
        return model
    }

    /** The document's operation of a call; an id the document does not serve names the gap. */
    private operationOf(model: ConnectorModel, connector: string, operationId: string): PinnedOperation {
        const operation = model.operations.get(operationId)
        if (operation === undefined) {
            throw new ProviderSandboxError({ code: ProviderSandboxErrorCode.CaseUnknown, params: { caseId: `${connector}:${operationId}` } })
        }
        return operation
    }

    /** The refusal case: the package's own 4xx of the operation, else a 422 in the document's shape; nothing applied. */
    private refusedOf(operation: PinnedOperation, fixture: OpenApiSandboxOperationFixture | undefined): OpenApiReachAnswer {
        const own = fixture?.refused
        if (own !== undefined) return answerOf(own.status, own.body)
        return this.problemOf(operation, OPENAPI_SANDBOX_REFUSAL_STATUS, "refused", "refused by the sandbox case OPENAPI-2")
    }

    /** The failure case: the package's own 5xx of the operation, else a 503 in the document's shape; nothing applied. */
    private failedOf(operation: PinnedOperation, fixture: OpenApiSandboxOperationFixture | undefined): OpenApiReachAnswer {
        const own = fixture?.failed
        if (own !== undefined) return answerOf(own.status, own.body)
        return this.problemOf(operation, OPENAPI_SANDBOX_FAILURE_STATUS, "unavailable", "failed by the sandbox case OPENAPI-3")
    }

    /** A problem answer of a status, shaped to the schema the document declares for it (`code`, `message` where it has them). */
    private problemOf(operation: PinnedOperation, status: number, code: string, message: string): OpenApiReachAnswer {
        return answerOf(status, shapedOf(responseSchemaOf(operation, status) ?? null, { code, message }))
    }

    /** The answer of the store to one call, by what the operation does. */
    private async answered(
        store: AccountStore,
        model: ConnectorModel,
        operation: PinnedOperation,
        fixture: OpenApiSandboxOperationFixture | undefined,
        call: OpenApiReachCall,
    ): Promise<OpenApiReachAnswer> {
        const resource: SandboxResource = resourceOf(operation, model.document.source.basePath, fixture)
        const schema = successSchemaOf(operation)
        const status = fixture?.status ?? successStatusOf(operation)
        const given = objectOf(call.input["body"])
        const params = Object.fromEntries(Object.entries(call.input).filter(([name]) => name !== "body"))
        const shaped = (value: unknown): OpenApiReachAnswer => answerOf(status, schema === null ? undefined : shapedOf(schema, value))
        switch (resource.kind) {
            case "fixed":
                return answerOf(status, fixture?.body)
            case "create": {
                const { collection } = resource
                const member = model.keys.get(collection)
                const reuses = fixture?.keeps?.reuses
                const open = reuses === undefined ? null : reusedRecordOf(await store.records(collection), given, reuses)
                if (open !== null) return shaped(open)
                const laid = { ...(fixture?.keeps === undefined ? {} : objectOf(fixture.body)), ...given }
                const key = (member === undefined ? null : keyTextOf(laid[member])) ?? (await store.nextKey(collection))
                const record = lentOf(member === undefined ? laid : { ...laid, [member]: key }, schema, await store.referencesOf(given, collection))
                await store.put(collection, key, record)
                return shaped(record)
            }
            case "list":
                return shaped(this.listed(schema, fixture, filteredOf(await store.records(resource.collection), params)))
            case "children": {
                const key = keyTextOf(call.input[resource.keyParam])
                if (key === null || (await store.get(resource.collection, key)) === null) return this.notFound(operation, key)
                const named = childrenOf(await store.records(resource.child), key, model.keys.get(resource.child))
                return shaped(this.listed(schema, fixture, filteredOf(named, params, [resource.keyParam])))
            }
            case "read":
            case "project": {
                const key = keyTextOf(call.input[resource.keyParam])
                const record = key === null ? null : await store.get(resource.collection, key)
                return record === null ? this.notFound(operation, key) : shaped(record)
            }
            case "update": {
                const key = keyTextOf(call.input[resource.keyParam])
                const record = key === null ? null : await store.get(resource.collection, key)
                if (key === null || record === null) return this.notFound(operation, key)
                const laid = { ...record, ...(fixture?.keeps === undefined ? {} : objectOf(fixture.body)), ...given }
                const changed = lentOf(laid, schema, await store.referencesOf(given, resource.collection))
                await store.put(resource.collection, key, changed)
                return shaped(changed)
            }
            case "remove": {
                const key = keyTextOf(call.input[resource.keyParam])
                const record = key === null ? null : await store.get(resource.collection, key)
                if (key === null || record === null) return this.notFound(operation, key)
                await store.remove(resource.collection, key)
                return shaped(record)
            }
            case "summary":
                return shaped(await this.summaryOf(store, model, schema))
        }
    }

    /** A list answer: the list itself, or the declared (else the schema's) list member beside the package's other members of the answer. */
    private listed(schema: SchemaNode | null, fixture: OpenApiSandboxOperationFixture | undefined, records: ReadonlyArray<Row>): unknown {
        const member = listMemberOf(schema, fixture?.listsBack?.listField)
        if (member === null) return records
        return { ...objectOf(fixture?.listsBack === undefined ? undefined : fixture.body), [member]: records }
    }

    /** A whole-collection answer that is no list: each member named like a collection holds its size; the rest takes the schema's default. */
    private async summaryOf(store: AccountStore, model: ConnectorModel, schema: SchemaNode | null): Promise<Row> {
        if (schema === null) return {}
        const counts: Record<string, number> = {}
        for (const collection of model.collections) counts[collection] = (await store.records(collection)).length
        return counts
    }

    /** No record of that key: a 404 in the shape the document declares for it. */
    private notFound(operation: PinnedOperation, key: string | null): OpenApiReachAnswer {
        return this.problemOf(operation, OPENAPI_SANDBOX_NOT_FOUND_STATUS, "not_found", `no record ${key ?? "(none named)"} in the sandbox`)
    }
}
