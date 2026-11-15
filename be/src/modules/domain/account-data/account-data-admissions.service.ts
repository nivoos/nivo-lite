import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AccountDataError, AccountDataErrorCode } from "./errors/account-data.error"
import type { AccountAdmission, AdmittedRow, ArrivingRow, PreparedAccountAdmission } from "./account-data.contracts"

/** A type's admission as registered: a plain one runs in the writing transaction, a prepared one is asked first with none open. */
type RegisteredAdmission =
    | { readonly kind: "plain"; readonly admission: AccountAdmission }
    | { readonly kind: "prepared"; readonly admission: PreparedAccountAdmission }

@Injectable()
/**
 * WHAT A NEW ROW OF A `wakes` TYPE DOES NEXT (account-data rule 7; owner R95: a new row is the signal): the provider that declares the type
 * registers ONE admission at boot (its door's tail: queue its consumer, or complete the row at once), and every receiver of that type calls
 * it in the transaction that wrote the row: the provider's webhook door after its claim, and the engine's one poll job after the intake
 * answered the row as new. So a row reaches its trigger by ONE road whichever way it was received; an existing row is never admitted.
 * A type whose tail must read through the pool or act outside (concept outbox-job rule 12) registers a PREPARED admission instead: the
 * receiver asks `prepared` for each arriving row BEFORE its transaction, then runs the answer in it for a new row.
 */
export class AccountDataAdmissionsService {
    private readonly byType = new Map<string, RegisteredAdmission>()

    /** Registers the admission of a type; another admission under a taken type is refused at boot. */
    register(type: string, admission: AccountAdmission): void {
        this.registered(type, { kind: "plain", admission })
    }

    /** Registers the PREPARED admission of a type; another admission under a taken type is refused at boot. */
    registerPrepared(type: string, admission: PreparedAccountAdmission): void {
        this.registered(type, { kind: "prepared", admission })
    }

    /** True when a type has an admission. */
    has(type: string): boolean {
        return this.byType.has(type)
    }

    /**
     * The admission an arriving row gets, prepared with NO transaction open: a prepared type's answer for the row, else the type's plain
     * admission. A type with no admission is a wiring error (refused, never skipped).
     */
    prepared(row: ArrivingRow): Promise<AccountAdmission> {
        const held = this.byType.get(row.type)
        if (held?.kind === "prepared") return held.admission(row)
        return Promise.resolve(this.plainOf(row.type))
    }

    /**
     * Admits one NEW row in the caller's transaction; a type with no admission is a wiring error (refused, never skipped), and so is a
     * type whose admission must be prepared (its receiver asks `prepared` before its transaction).
     */
    async admit(tx: EntityManager, row: AdmittedRow): Promise<void> {
        await this.plainOf(row.type)(tx, row)
    }

    private plainOf(type: string): AccountAdmission {
        const held = this.byType.get(type)
        if (held?.kind !== "plain") throw new AccountDataError({ code: AccountDataErrorCode.AdmissionMissing, params: { type } })
        return held.admission
    }

    private registered(type: string, admission: RegisteredAdmission): void {
        const held = this.byType.get(type)
        if (held?.admission === admission.admission) return
        if (held !== undefined) throw new AccountDataError({ code: AccountDataErrorCode.AdmissionTaken, params: { type } })
        this.byType.set(type, admission)
    }
}
