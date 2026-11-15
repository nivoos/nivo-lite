import { Module, type DynamicModule } from "@nestjs/common"
import { TypeOrmModule, getDataSourceToken } from "@nestjs/typeorm"
import type { DataSource } from "typeorm"
import { DATABASE_OPTIONS } from "./database.port"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./database.module-definition"
import { AfterCommitClient } from "./after-commit.client"
import { MigrationRunnerService } from "./migration-runner.service"
import { PRIMARY_CONNECTION } from "./primary.connection"
import { AFTER_COMMIT, PRIMARY_ENTITY_MANAGER, RATE_LIMIT_STORE } from "./primary.decorators"
import { PostgresRateLimitStoreClient } from "./postgres-rate-limit-store.client"
import { SeedRunnerService } from "./seed-runner.service"
import { DEFAULT_POOL_BOUND } from "./primary.config"
import { poolOptionsOf, typeAcquireFailures } from "./pool-bound.client"

/** The token each declared connection provides its shared EntityManager under. */
type EntityManagerToken = typeof PRIMARY_ENTITY_MANAGER

/** Token of the provider that subscribes the after-commit capability to the primary connection. */
const AFTER_COMMIT_SUBSCRIPTION: unique symbol = Symbol("platform.database.after-commit-subscription")

/** Token of the provider that types the primary connection's acquire failures (`typeAcquireFailures`); nothing injects it. */
const ACQUIRE_BOUND: unique symbol = Symbol("platform.database.acquire-bound")

/** Types the primary pool's acquire failures once its data source is open (THE BOUND, D3-W1-6). */
const primaryAcquireBound = {
    provide: ACQUIRE_BOUND,
    inject: [getDataSourceToken(PRIMARY_CONNECTION)],
    useFactory: (source: DataSource): boolean => {
        typeAcquireFailures(source)
        return true
    },
}

const ENTITY_MANAGER_TOKENS: ReadonlyMap<string, EntityManagerToken> = new Map<string, EntityManagerToken>([
    [PRIMARY_CONNECTION, PRIMARY_ENTITY_MANAGER],
])

@Module({})
/**
 * Opens each named PostgreSQL connection, bounded (`DatabasePoolBound`), and exposes its shared EntityManager mapping the entities the app passes in (`PRIMARY_ENTITIES`); schema changes stay in `db/migrations` and `synchronize` is off.
 */
export class DatabaseModule extends ConfigurableModuleClass {
    /** Registers the capability once per app with the connections it opens. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        const managers = options.connections.flatMap((connection) => {
            const token = ENTITY_MANAGER_TOKENS.get(connection.name)
            return token === undefined
                ? []
                : [
                      {
                          provide: token,
                          inject: [getDataSourceToken(connection.name)],
                          useFactory: (source: DataSource) => source.manager,
                      },
                  ]
        })
        const hasPrimary = options.connections.some((connection) => connection.name === PRIMARY_CONNECTION)
        const afterCommit = [
            { provide: AFTER_COMMIT, useExisting: AfterCommitClient },
            AfterCommitClient,
            ...(hasPrimary
                ? [
                      {
                          provide: AFTER_COMMIT_SUBSCRIPTION,
                          inject: [getDataSourceToken(PRIMARY_CONNECTION), AfterCommitClient],
                          useFactory: (source: DataSource, client: AfterCommitClient) =>
                              source.subscribers.push({
                                  afterTransactionCommit: (event) => client.commit(event.manager),
                                  afterTransactionRollback: (event) => client.rollback(event.manager),
                              }),
                      },
                  ]
                : []),
        ]
        return {
            ...base,
            imports: [
                ...(base.imports ?? []),
                ...options.connections.map((connection) => {
                    const schema: Partial<Record<"schema", string>> =
                        connection.schema === undefined ? {} : { schema: connection.schema }
                    return TypeOrmModule.forRoot({
                        name: connection.name,
                        type: "postgres",
                        url: connection.url.reveal(),
                        ...schema,
                        entities: [...options.entities],
                        uuidExtension: "pgcrypto",
                        synchronize: false,
                        // A first start brings the database up beside the app: keep retrying for about 30 s while it accepts its first connection.
                        retryAttempts: 10,
                        retryDelay: 3000,
                        // THE BOUND (D3-W1-6): pool size, acquire wait, lock wait and idle transaction, so the app never stands still.
                        extra: { types: options.typeParsers(), ...poolOptionsOf(connection.bound ?? DEFAULT_POOL_BOUND) },
                    })
                }),
            ],
            providers: [
                ...(base.providers ?? []),
                ...managers,
                { provide: RATE_LIMIT_STORE, useClass: PostgresRateLimitStoreClient },
                ...afterCommit,
                ...(hasPrimary ? [primaryAcquireBound] : []),
                MigrationRunnerService,
                SeedRunnerService,
            ],
            exports: [
                DATABASE_OPTIONS,
                RATE_LIMIT_STORE,
                AFTER_COMMIT,
                ...managers.map((manager) => manager.provide),
                MigrationRunnerService,
                SeedRunnerService,
            ],
        }
    }
}
