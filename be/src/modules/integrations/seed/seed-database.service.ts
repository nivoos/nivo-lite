import { Injectable, type OnModuleDestroy } from "@nestjs/common"
import type { PostgresRunner } from "@starci/seed/postgres"
import type { OwnerConnection, OwnerStatements } from "@modules/platform/database"
import type { Secret } from "@modules/platform/config"
import { InjectSeedDatabaseConnector, InjectSeedDatabaseUrl } from "./seed.decorators"
import type { SeedDatabaseConnector } from "./seed.port"

/** The isolation level the store asks for, as the database names it. */
const ISOLATIONS = { "repeatable read": "REPEATABLE READ", "read committed": "READ COMMITTED" } as const

@Injectable()
/**
 * The statement runner of the whole-database store over ONE DEDICATED connection opened with the environment's database OWNER role
 * (`DATABASE_OWNER_URL`): the export must see every table without row-level filtering and the import needs `session_replication_role`,
 * so this is never the app's own role (`app_be` is never widened). The connection is opened on the first statement, so an app that
 * never backs up opens nothing, and closed when the app shuts down. The statement text is the store's, passed through as given.
 */
export class SeedDatabaseService implements PostgresRunner, OnModuleDestroy {
    private opening: Promise<OwnerConnection> | null = null

    constructor(
        @InjectSeedDatabaseUrl() private readonly url: Secret,
        @InjectSeedDatabaseConnector() private readonly connector: SeedDatabaseConnector,
    ) {}

    /** Runs one statement outside a transaction. */
    async query(text: string, params?: ReadonlyArray<unknown>): ReturnType<PostgresRunner["query"]> {
        return (await this.opened()).run(text, params)
    }

    /** Runs `work` in one transaction of the isolation level the store names; the statements it runs see one snapshot (repeatable read). */
    async transaction<T>(
        isolation: "repeatable read" | "read committed",
        work: (tx: PostgresRunner) => Promise<T>,
    ): Promise<T> {
        const connection = await this.opened()
        return connection.transaction(ISOLATIONS[isolation], (statements) => work(this.within(statements)))
    }

    /** Closes the connection when one was opened. */
    async onModuleDestroy(): Promise<void> {
        const opening = this.opening
        this.opening = null
        if (opening !== null) await (await opening).destroy()
    }

    /** The runner of one open transaction: its statements run in it, and a transaction asked for inside it is the same one. */
    private within(statements: OwnerStatements): PostgresRunner {
        const runner: PostgresRunner = {
            query: (text, params) => statements.run(text, params),
            transaction: (_isolation, work) => work(runner),
        }
        return runner
    }

    /** The open connection; the first call opens it with the declared URL, a call meanwhile waits for that one. */
    private opened(): Promise<OwnerConnection> {
        this.opening ??= this.open()
        return this.opening
    }

    /** Opens the connection; a failure is forgotten so the next statement tries again. */
    private async open(): Promise<OwnerConnection> {
        const connection = this.connector.connect(this.url.reveal())
        try {
            await connection.initialize()
        } catch (cause) {
            this.opening = null
            throw cause
        }
        return connection
    }
}
