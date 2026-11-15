import { Command, CommandRunner } from "nest-commander"
import { DataStoreServeService } from "@modules/domain/data-stores"

@Command({
    name: "data-store",
    description:
        "Serve one store of this deployment over the line protocol starci/data-entries@1 (stdin and stdout lines): data-store <storeId> describe | export <selection json> | import <options json> | identity <set> <key>. The harness `starci app data sync` runs it; the stores are database-all, storage-all, database and storage.",
    arguments: "<storeId> <verb> [argument...]",
})
/** `cli data-store <storeId> <verb> ...`: one store as the harness's data sync reaches it. */
export class DataStoreCli extends CommandRunner {
    constructor(private readonly serving: DataStoreServeService) {
        super()
    }

    /** Hands the store and the verb with its arguments to the serving capability; a refused call sets the exit code there. */
    async run([storeId = "", ...args]: Array<string>): Promise<void> {
        await this.serving.serveOnConsole(storeId, args)
    }
}
