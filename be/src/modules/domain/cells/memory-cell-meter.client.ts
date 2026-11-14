import { Injectable } from "@nestjs/common"
import type { CellMeter } from "./cell-meter.port"
import type { CellRef, UsageFigures } from "./cells.contracts"

/** One booking the meter kept. */
export interface MeterBookingView {
    readonly workspaceId: string
    readonly cell: CellRef
    readonly usage: UsageFigures
    readonly billed: boolean
}

@Injectable()
/**
 * The phase-0 credit meter over one pool per workspace, in units (the real one binds to the credit books at migration step M2). A billed
 * booking draws the pool down; a failed try is kept and never billed. A workspace with no pool set has none.
 */
export class MemoryCellMeterClient implements CellMeter {
    private readonly pools = new Map<string, number>()
    private readonly kept: Array<MeterBookingView> = []

    /** Sets the pool of a workspace. */
    fund(workspaceId: string, units: number): void {
        this.pools.set(workspaceId, units)
    }

    /** The pool left of a workspace. */
    balanceOf(workspaceId: string): number {
        return this.pools.get(workspaceId) ?? 0
    }

    /** Every booking, in order. */
    bookings(): ReadonlyArray<MeterBookingView> {
        return this.kept
    }

    allows(workspaceId: string, _cell: CellRef, estimate: UsageFigures | null): Promise<boolean> {
        const pool = this.balanceOf(workspaceId)
        return Promise.resolve(pool > 0 && (estimate === null || pool >= estimate.units))
    }

    book(workspaceId: string, cell: CellRef, usage: UsageFigures, billed: boolean): Promise<void> {
        this.kept.push({ workspaceId, cell, usage, billed })
        if (billed) this.pools.set(workspaceId, this.balanceOf(workspaceId) - usage.units)
        return Promise.resolve()
    }
}
