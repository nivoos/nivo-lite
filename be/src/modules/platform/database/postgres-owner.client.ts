import { DataSource } from "typeorm"
import type { OwnerConnection, OwnerRow } from "./postgres-owner.contracts"

/** The sockets one owner connection may hold: one export or import runs at a time. */
const OWNER_SOCKETS = 2

/**
 * Builds a dedicated TypeORM connection to a PostgreSQL URL (no entity, no synchronize), unopened. The statement text is whatever the
 * whole-database copy sends: the app writes no SQL here.
 */
export const openOwnerConnection = (url: string): OwnerConnection => {
    const source = new DataSource({ type: "postgres", url, synchronize: false, entities: [], extra: { max: OWNER_SOCKETS } })
    return {
        initialize: async () => {
            await source.initialize()
        },
        run: (text, params) => source.query<Array<OwnerRow>>(text, params === undefined ? undefined : [...params]),
        transaction: (isolation, work) =>
            source.transaction(isolation, (manager) =>
                work({ run: (text, params) => manager.query<Array<OwnerRow>>(text, params === undefined ? undefined : [...params]) }),
            ),
        destroy: async () => {
            await source.destroy()
        },
    }
}
