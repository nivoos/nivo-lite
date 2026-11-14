import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AccountDataError, AccountDataErrorCode } from "./errors/account-data.error"
import type { AccountAdmission, AdmittedRow } from "./account-data.contracts"

@Injectable()
/**
 * WHAT A NEW ROW OF A `wakes` TYPE DOES NEXT (account-data rule 7; owner R95: a new row is the signal): the provider that declares the type
 * registers ONE admission at boot (its door's tail: queue its consumer, or complete the row at once), and every receiver of that type calls
 * it in the transaction that wrote the row: the provider's webhook door after its claim, and the engine's one poll job after the intake
 * answered the row as new. So a row reaches its trigger by ONE road whichever way it was received; an existing row is never admitted.
 */
export class AccountDataAdmissionsService {
    private readonly byType = new Map<string, AccountAdmission>()

    /** Registers the admission of a type; another admission under a taken type is refused at boot. */
    register(type: string, admission: AccountAdmission): void {
        const held = this.byType.get(type)
        if (held === admission) return
        if (held !== undefined) throw new AccountDataError({ code: AccountDataErrorCode.AdmissionTaken, params: { type } })
        this.byType.set(type, admission)
    }

    /** True when a type has an admission. */
    has(type: string): boolean {
        return this.byType.has(type)
    }

    /** Admits one NEW row in the caller's transaction; a type with no admission is a wiring error (refused, never skipped). */
    async admit(tx: EntityManager, row: AdmittedRow): Promise<void> {
        const admission = this.byType.get(row.type)
        if (admission === undefined) throw new AccountDataError({ code: AccountDataErrorCode.AdmissionMissing, params: { type: row.type } })
        await admission(tx, row)
    }
}
