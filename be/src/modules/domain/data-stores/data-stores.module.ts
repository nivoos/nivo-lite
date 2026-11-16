import { Module, type DynamicModule } from "@nestjs/common"
import { STORAGE_BUCKETS_PORT, type StorageBucketsPort } from "@modules/integrations/object-storage"
import { SEED_DATABASE_ALL, type StoreAdapter } from "@modules/integrations/seed"
import { DATA_STORES, DATA_STORE_CONSOLE, type DataStores } from "./data-stores.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./data-stores.module-definition"
import { DATABASE_CANNOT, NO_CONSOLE, STORAGE_CANNOT } from "./data-stores.policy"
import { DataStoreServeService } from "./data-store-serve.service"
import { KnowledgeSourcesDoor } from "./knowledge-sources.adapter"
import { RecordFilesWorkspaceObjects } from "./record-files-workspace-objects.service"
import { WorkspaceDatabaseStore } from "./workspace-database.adapter"
import { WorkspaceDirectoryService } from "./workspace-directory.service"
import { WorkspaceSettingsDoor } from "./workspace-settings.adapter"
import { StorageAllStore } from "./storage-all.adapter"
import { WorkspaceStorageStore } from "./workspace-storage.adapter"

/** The stores of the data standard, built from the doors and the directory. */
const storesOf = (
    directory: WorkspaceDirectoryService,
    settings: WorkspaceSettingsDoor,
    knowledge: KnowledgeSourcesDoor,
    objects: RecordFilesWorkspaceObjects,
    buckets: StorageBucketsPort,
    databaseAll: StoreAdapter | null,
): DataStores => [
    new WorkspaceDatabaseStore(directory, [settings, knowledge], DATABASE_CANNOT),
    new WorkspaceStorageStore(directory, objects, STORAGE_CANNOT),
    new StorageAllStore(buckets),
    ...(databaseAll === null ? [] : [databaseAll]),
]

@Module({})
/**
 * The stores of NIVO's data standard: the workspace's foundation rows (`database`) and its files (`storage`), and the two whole-deployment
 * stores of the backup: every object of every owned bucket (`storage-all`) and, when the environment declares its owner connection, the whole
 * relational database (`database-all`), exported under the
 * `DATA_STORES` token as `ReadonlyArray<StoreAdapter>`. The services they read and write through come from the modules the app root
 * registers globally (workspace settings, knowledge sources, object storage, the entity engine).
 */
export class DataStoresModule extends ConfigurableModuleClass {
    /** Registers the stores once in an app root. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                WorkspaceDirectoryService,
                WorkspaceSettingsDoor,
                KnowledgeSourcesDoor,
                RecordFilesWorkspaceObjects,
                DataStoreServeService,
                { provide: DATA_STORE_CONSOLE, useValue: options.console ?? NO_CONSOLE },
                {
                    provide: DATA_STORES,
                    inject: [
                        WorkspaceDirectoryService,
                        WorkspaceSettingsDoor,
                        KnowledgeSourcesDoor,
                        RecordFilesWorkspaceObjects,
                        STORAGE_BUCKETS_PORT,
                        SEED_DATABASE_ALL,
                    ],
                    useFactory: storesOf,
                },
            ],
            exports: [DATA_STORES, DataStoreServeService],
        }
    }
}
