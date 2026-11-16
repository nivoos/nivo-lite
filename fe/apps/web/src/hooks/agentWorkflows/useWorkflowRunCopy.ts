"use client"

import { useTranslations } from "next-intl"
import type { WorkflowRunCopy } from "@/modules/types"

/** The words of the stop, start and end-all commands of a workflow. */
export const useWorkflowRunCopy = (): WorkflowRunCopy => {
    const t = useTranslations("workflowStop")
    return {
        statusActive: t("statusActive"),
        statusPaused: t("statusPaused"),
        stop: t("stop"),
        start: t("start"),
        endAll: t("endAll"),
        rowStop: t("rowStop"),
        rowStart: t("rowStart"),
        rowActions: t("rowActions"),
        line: (run, withVersion) => {
            const runs = run.runsInFlight > 0 ? t("lineRuns", { count: run.runsInFlight }) : ""
            if (run.status === "active")
                return [runs, withVersion ? t("lineVersion", { version: run.version }) : ""]
                    .filter((part) => part !== "")
                    .join(" · ")
            if (run.status !== "paused") return ""
            return [
                t("lineNoNew"),
                run.eventsHeld > 0 ? t("lineHeld", { count: run.eventsHeld }) : "",
                run.eventsSkipped > 0 ? t("lineSkipped", { count: run.eventsSkipped }) : "",
                runs,
            ]
                .filter((part) => part !== "")
                .join(" · ")
        },
        stopTitle: (name) => t("stopTitle", { name }),
        stopBody: (runs) => (runs > 0 ? t("stopBody", { count: runs }) : t("stopBodyNone")),
        stopEndRuns: (runs) => t("stopEndRuns", { count: runs }),
        stopHold: t("stopHold"),
        stopHoldHelp: t("stopHoldHelp"),
        stopConfirm: t("stopConfirm"),
        endTitle: t("endTitle"),
        endBody: (name, runs) => t("endBody", { name, count: runs }),
        endConfirm: t("endConfirm"),
        startTitle: (name) => t("startTitle", { name }),
        startBody: (held) => (held > 0 ? t("startBodyHeld", { count: held }) : t("startBody")),
        startConfirm: t("startConfirm"),
        cancel: t("cancel"),
    }
}
