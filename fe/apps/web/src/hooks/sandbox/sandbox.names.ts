import type { useTranslations } from "next-intl"

/** A reader of the `sandbox` catalog. */
export type SandboxSay = ReturnType<typeof useTranslations<"sandbox">>

/** The words of each delivery mode of the frame, each key read by its literal name. */
export const modeNamesOf = (t: SandboxSay): Readonly<Record<string, string>> => ({
    once: t("modeOnce"),
    twice: t("modeTwice"),
    withheld: t("modeWithheld"),
    late: t("modeLate"),
})

/** The words of each outcome of the frame, each key read by its literal name. */
export const outcomeNamesOf = (t: SandboxSay): Readonly<Record<string, string>> => ({
    ok: t("outcomeOk"),
    refused: t("outcomeRefused"),
    final: t("outcomeFinal"),
    transient: t("outcomeTransient"),
    timeout: t("outcomeTimeout"),
})

/** The words of each unit of a `late` interval. */
export const unitNamesOf = (t: SandboxSay): Readonly<Record<string, string>> => ({
    minutes: t("unitMinutes"),
    hours: t("unitHours"),
    days: t("unitDays"),
})

/** A word of a map, or the key itself when the frame answers one the page has no words for. */
export const wordOf = (names: Readonly<Record<string, string>>, key: string): string => names[key] ?? key
