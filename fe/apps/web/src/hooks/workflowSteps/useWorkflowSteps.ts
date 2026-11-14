"use client"

import { useLocale } from "next-intl"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { WORKFLOW_STEP_PARAM } from "@/modules/routes"
import {
    graphOfSpec,
    settingsOfStep,
    specOf,
    stepAccountsViewOf,
    stepDrawerOf,
    stepsLocaleOf,
} from "@/modules/workflowSteps"
import type {
    StepAccountsPanelView,
    StepAction,
    StepDrawerView,
    StepsMapView,
    WorkflowNodeSettings,
} from "@/modules/types"
import { useExplainWords } from "./useExplainWords"
import { useStepAccountChoice } from "./useStepAccountChoice"
import { useStepAccounts } from "./useStepAccounts"
import { useStepRunMode } from "./useStepRunMode"
import { useStepSettingsWords } from "./useStepSettingsWords"
import { useStepSettingsWrite } from "./useStepSettingsWrite"
import { useStepsMap } from "./useStepsMap"

/** The workflow a setting of a step writes to: its id and the newest version number the page read. */
interface StepsWorkflow {
    readonly id: string
    readonly latestNumber: number
}

/** What the card map of a workflow is drawn from and where the two settings of a step go. */
interface WorkflowStepsInput {
    readonly installationId: string
    /** The graph: JSON text (a workflow version) or a parsed document (the flow of the agent graph); null while unread. */
    readonly graph: unknown
    /** The workflow a setting writes a new version of; null when there is none (the drawer still opens, read only). */
    readonly workflow: StepsWorkflow | null
    /** What each step lets a shop set and what is in force (`agentWorkflow.nodeSettings`); undefined while unread or when there is no workflow. */
    readonly nodeSettings?: ReadonlyArray<WorkflowNodeSettings> | undefined
    /** True for the drawer of a run: the settings the run used, nothing to set. */
    readonly isReadOnly?: boolean
    /** Reads the workflow (and anything drawn from it) again after a setting changed. */
    readonly onSaved?: () => Promise<unknown>
}

/** The card map, the step whose drawer is open, the drawer and what a person does with it. */
export interface WorkflowSteps {
    readonly map: StepsMapView
    readonly selectedId: string | null
    readonly drawer: StepDrawerView
    readonly act: (action: StepAction) => void
}

/** The key of the step the address names (`?step=<node>`), or an empty string. */
const useWantedStep = (): string => useSearchParams().get(WORKFLOW_STEP_PARAM) ?? ""

/**
 * The card map of a workflow and the drawer of its steps: pressing a step opens the READ ONLY explanation of everything about it. A
 * workflow's graph is exactly its template's, so the drawer edits no graph; the only two things it sets are how the step runs
 * (`auto | ask`) and which of the agent's attached accounts it uses. `?step=<node>` opens that step.
 */
export const useWorkflowSteps = (input: WorkflowStepsInput): WorkflowSteps => {
    const locale = stepsLocaleOf(useLocale())
    const [openKey, setOpenKey] = useState("")
    const spec = useMemo(() => specOf(input.graph), [input.graph])
    const graph = useMemo(() => graphOfSpec(spec, locale), [spec, locale])
    const { attached, words: accountWords } = useStepAccounts(input.installationId)
    const map = useStepsMap(spec, graph, locale, attached, accountWords)
    const words = useExplainWords()
    const wanted = useWantedStep()
    const opened = useRef("")
    useEffect(() => {
        const node = graph.nodes.find((one) => one.id === wanted)
        if (wanted === "" || node === undefined || opened.current === wanted) return
        opened.current = wanted
        setOpenKey(wanted)
    }, [wanted, graph])
    const isRun = input.isReadOnly === true
    const base = stepDrawerOf(
        { spec, graph, map, nodeKey: openKey },
        words,
        { closeLabel: words.closeLabel, readOnlyNote: isRun ? words.readOnlyNote : words.noWorkflowNote },
        isRun || input.workflow === null,
    )
    const reload = async (): Promise<unknown> => input.onSaved?.()
    const settingsWords = useStepSettingsWords()
    const hasStep = spec?.nodes.some((node) => node.key === openKey) === true
    const settings = hasStep && !isRun ? settingsOfStep(input.nodeSettings, openKey) : undefined
    const write = useStepSettingsWrite(input.installationId, input.workflow, openKey, reload)
    const isFrozen = base.isReadOnly
    const runMode = useStepRunMode({ settings, words: settingsWords, write, isFrozen, isRun })
    const choice = useStepAccountChoice(write, isFrozen)
    const accountsRead = stepAccountsViewOf(settings, settingsWords, {
        isOwner: choice.isOwner,
        isFrozen,
        isPending: write.isPending,
    })
    const accountsView: StepAccountsPanelView | undefined =
        accountsRead === null
            ? undefined
            : {
                  view: accountsRead,
                  isPending: choice.isPending,
                  defaultLabel: words.defaultLabel,
                  sandboxLabel: words.sandboxLabel,
              }
    const drawer: StepDrawerView = {
        ...base,
        runMode: runMode.view,
        ...(accountsView === undefined ? {} : { accounts: accountsView }),
    }
    return {
        map,
        selectedId: openKey === "" ? null : openKey,
        drawer,
        act: (action) => {
            if (action.kind === "close") return setOpenKey("")
            if (action.kind === "open") return setOpenKey(action.nodeKey)
            if (spec === null || isRun) return undefined
            if (action.kind === "node-mode") return runMode.choose(action.mode)
            return choice.choose(action.ids)
        },
    }
}
