/** Vietnam keeps no daylight saving, so its clock (Asia/Ho_Chi_Minh) is a fixed offset from UTC. */
export const VN_OFFSET_MS = 7 * 3_600_000

/** The day of the week in Vietnam time of an instant: 0 is Sunday, 1 Monday, up to 6 Saturday. */
export const vnWeekday = (ms: number): number => new Date(ms + VN_OFFSET_MS).getUTCDay()

/** The UTC instant of midnight, Vietnam time, of the day an instant falls on. */
export const vnMidnight = (ms: number): number =>
    Math.floor((ms + VN_OFFSET_MS) / 86_400_000) * 86_400_000 - VN_OFFSET_MS

/** `10:30` as minutes since midnight (630); a value that is not a time reads as midnight. */
export const minutesOf = (clock: string): number => {
    const [hours, minutes] = clock.split(":")
    const total = Number(hours) * 60 + Number(minutes)
    return Number.isFinite(total) ? total : 0
}

/** `T2 19/11 10:00` of an instant, in Vietnam time (the way a person writes a demo slot). */
export const vnLabel = (ms: number): string => {
    const at = new Date(ms + VN_OFFSET_MS).toISOString()
    const days = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]
    return `${days[vnWeekday(ms)] ?? ""} ${at.slice(8, 10)}/${at.slice(5, 7)} ${at.slice(11, 16)}`
}
