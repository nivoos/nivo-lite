import { Injectable } from "@nestjs/common"
import type { CellLedger } from "./cell-ledger.port"
import type { CellOutcome } from "./cells.contracts"

@Injectable()
/**
 * The phase-0 intent ledger over a map (the V1 adapter comes at migration step M5). Once per key: a settled key answers its kept outcome
 * without acting, a key whose act began and never settled answers `unknown`, a throw releases the key unless it carries `outcomeUnknown: 1`.
 */
export class MemoryCellLedgerClient implements CellLedger {
    private readonly entries = new Map<string, CellOutcome | null>()

    async once(key: string, act: () => Promise<CellOutcome>): Promise<{ readonly replayed: boolean; readonly outcome: CellOutcome }> {
        if (this.entries.has(key)) {
            return { replayed: true, outcome: this.entries.get(key) ?? { kind: "unknown", key } }
        }
        this.entries.set(key, null)
        try {
            const outcome = await act()
            this.entries.set(key, outcome)
            return { replayed: false, outcome }
        } catch (cause: unknown) {
            if (Reflect.get(Object(cause), "outcomeUnknown") !== 1) this.entries.delete(key)
            throw cause
        }
    }
}
