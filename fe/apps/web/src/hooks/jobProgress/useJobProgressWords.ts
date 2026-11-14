"use client"

import { useFormatter, useTranslations } from "next-intl"
import type { JobProgressWords } from "@/modules/jobProgress"

/** The words of the job states in the reader's language and clock: the `jobProgress` catalog. */
export const useJobProgressWords = (): JobProgressWords => {
    const t = useTranslations("jobProgress")
    const format = useFormatter()
    return {
        say: (key, values) => t(key, values),
        clock: (iso) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" }),
    }
}
