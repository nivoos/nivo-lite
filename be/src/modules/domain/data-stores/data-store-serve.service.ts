import { Injectable } from "@nestjs/common"
import { serveStore, type ServeIo } from "@modules/integrations/seed"
import { InjectDataStoreConsole, InjectDataStores, type DataStores } from "./data-stores.decorators"
import type { DataStoreConsole } from "./data-stores.options"

/** The exit code of a call that names a store this deployment has not got. */
const UNKNOWN_STORE_EXIT = 3

@Injectable()
/**
 * Serves one named store over the line protocol `starci/data-entries@1` (describe, export, import, identity), the way the harness's
 * `starci app data sync` reaches the stores of the deployment through the app's own command. The store answers on the console of the app
 * (stdout lines: the caller keeps logs on another stream) and a refused call sets the exit code.
 */
export class DataStoreServeService {
    constructor(
        @InjectDataStores() private readonly stores: DataStores,
        @InjectDataStoreConsole() private readonly console: DataStoreConsole,
    ) {}

    /** The ids of every store of this deployment. */
    ids(): ReadonlyArray<string> {
        return this.stores.map((store) => store.id)
    }

    /** Serves the store on the console: `args` are the verb and its arguments; the input lines are opened only when the verb reads them. */
    async serveOnConsole(storeId: string, args: ReadonlyArray<string>): Promise<void> {
        const code = await this.serve(storeId, {
            args,
            lines: { [Symbol.asyncIterator]: () => this.console.lines()[Symbol.asyncIterator]() },
            write: this.console.print,
        })
        if (code !== 0) this.console.exit(code)
    }

    /** Serves the store over the given input and output; answers the exit code (0 served, 2 a malformed call, 3 an unknown store). */
    serve(storeId: string, io: ServeIo): Promise<number> {
        const store = this.stores.find((candidate) => candidate.id === storeId)
        if (store === undefined) {
            io.write(JSON.stringify({ error: "DATA_STORE_UNKNOWN", store: storeId, stores: this.ids() }))
            return Promise.resolve(UNKNOWN_STORE_EXIT)
        }
        return serveStore(store, io)
    }
}
