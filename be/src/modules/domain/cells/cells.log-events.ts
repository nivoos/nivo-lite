/** Log events of the cells capability (BE-LOGGING-2): an owner's enum member, fields are ids and codes only. */
export enum CellsLogEvent {
    /** One cell execution ended: fields are the cell ref, the run, the step, the outcome kind and the verdict kind. */
    Executed = "cells.executed",
    /** The meter gate refused a metered cell because the workspace has no credits left; nothing ran. */
    CreditsExhausted = "cells.credits_exhausted",
    /** A write was answered from its recorded intent without running again. */
    Replayed = "cells.replayed",
    /** A source reached for a tool its cell did not declare; the run ended typed. */
    ToolUndeclared = "cells.tool_undeclared",
    /** A usage booking failed after the cell ran; the execution answer is kept. */
    BookingFailed = "cells.booking_failed",
}
