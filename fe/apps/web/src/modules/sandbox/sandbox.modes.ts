/** The delivery modes the sandbox frame offers for an inbound case: the frame's own words, the same for every provider. */
export const SANDBOX_DELIVERY_MODES = ["once", "twice", "withheld", "late"] as const

/** One delivery mode. */
export type SandboxDeliveryMode = (typeof SANDBOX_DELIVERY_MODES)[number]

/** The units an interval of `late` is written in, and the seconds each stands for. */
export const SANDBOX_LATE_UNITS = { minutes: 60, hours: 3600, days: 86400 } as const

/** One unit of a `late` interval. */
export type SandboxLateUnit = keyof typeof SANDBOX_LATE_UNITS

/** The units in the order the picker lists them. */
export const SANDBOX_LATE_UNIT_IDS: ReadonlyArray<SandboxLateUnit> = ["minutes", "hours", "days"]

/** The frame's bound on `late`: thirty days, in seconds (the back end refuses more). */
export const SANDBOX_LATE_MAX_SECONDS = 30 * SANDBOX_LATE_UNITS.days

/** The start of a `late` interval: one hour, the frame's own default. */
export const SANDBOX_LATE_START = { amount: 1, unit: "hours" } as const satisfies { amount: number; unit: SandboxLateUnit }

/** What a mode decision reads of an inbound case. */
export interface SandboxModeCase {
    /** The mode the case is a name for (`twice`, `late`, ...); null when it is delivered once. */
    readonly delivery: string | null
    /** The provider's poll returns what the case keeps, so the case may be withheld. */
    readonly polled: boolean
}

/**
 * The modes a case allows. A case that is itself a name for a mode (`delivery` set) is sent as it is: the one mode `once` stands for
 * "as the case says". Any other case is sent once, twice or late; withheld only when the provider's poll can bring it back.
 */
export const deliveryModesOf = (one: SandboxModeCase): ReadonlyArray<SandboxDeliveryMode> => {
    if (one.delivery !== null) return ["once"]
    return SANDBOX_DELIVERY_MODES.filter((mode) => mode !== "withheld" || one.polled)
}

/** The modes at least one of the cases allows, in the frame's order: what the mode switch offers. */
export const deliveryChoicesOf = (cases: ReadonlyArray<SandboxModeCase>): ReadonlyArray<SandboxDeliveryMode> =>
    SANDBOX_DELIVERY_MODES.filter((mode) => cases.some((one) => deliveryModesOf(one).includes(mode)))

/** Whether a mode is one of the frame's (a word the page has copy for). */
export const isDeliveryMode = (value: string): value is SandboxDeliveryMode =>
    (SANDBOX_DELIVERY_MODES as ReadonlyArray<string>).includes(value)

/** The seconds of a `late` interval written as an amount and a unit; null when it is not a whole positive number within the frame's bound. */
export const lateSecondsOf = (amount: number, unit: SandboxLateUnit): number | null => {
    const seconds = amount * SANDBOX_LATE_UNITS[unit]
    return Number.isInteger(seconds) && seconds >= 1 && seconds <= SANDBOX_LATE_MAX_SECONDS ? seconds : null
}

/** What a send carries of the mode: nothing for `once` (the case's own way), else the mode and, for `late`, its seconds. */
export interface SandboxModeInput {
    readonly mode?: SandboxDeliveryMode
    readonly lateBySeconds?: number
}

/** The mode part of a send, or null when the chosen mode cannot be sent (`late` with an interval the frame refuses). */
export const modeInputOf = (mode: SandboxDeliveryMode, amount: number, unit: SandboxLateUnit): SandboxModeInput | null => {
    if (mode === "once") return {}
    if (mode !== "late") return { mode }
    const seconds = lateSecondsOf(amount, unit)
    return seconds === null ? null : { mode, lateBySeconds: seconds }
}
