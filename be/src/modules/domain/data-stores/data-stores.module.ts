import { Module, type DynamicModule } from "@nestjs/common"
import { DATA_STORES, type DataStores } from "./data-stores.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./data-stores.module-definition"
import { DATABASE_CANNOT, STORAGE_CANNOT } from "./data-stores.policy"
import { KnowledgeSourcesDoor } from "./knowledge-sources.adapter"
import { RecordFilesWorkspaceObjects } from "./record-files-workspace-objects.service"
import { WorkspaceDatabaseStore } from "./workspace-database.adapter"
import { WorkspaceDirectoryService } from "./workspace-directory.service"
import { WorkspaceSettingsDoor } from "./workspace-settings.adapter"
import { WorkspaceStorageStore } from "./workspace-storage.adapter"

/** The stores of the data standard, built from the doors and the directory. */
const storesOf = (
    directory: WorkspaceDirectoryService,
    settings: WorkspaceSettingsDoor,
    knowledge: KnowledgeSourcesDoor,
    objects: RecordFilesWorkspaceObjects,
): DataStores => [
    new WorkspaceDatabaseStore(directory, [settings, knowledge], DATABASE_CANNOT),
    new WorkspaceStorageStore(directory, objects, STORAGE_CANNOT),
]

@Module({})
/**
 * The stores of NIVO's data standard: the workspace's foundation rows (`database`) and its files (`storage`), exported under the
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
                {
                    provide: DATA_STORES,
                    inject: [
                        WorkspaceDirectoryService,
                        WorkspaceSettingsDoor,
                        KnowledgeSourcesDoor,
                        RecordFilesWorkspaceObjects,
                    ],
                    useFactory: storesOf,
                },
            ],
            exports: [DATA_STORES],
        }
    }
}
