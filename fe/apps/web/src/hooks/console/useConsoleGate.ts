"use client"

import { useEffect } from "react"
import { useMutateStartFirstWorkspaceSwr, useQueryMyWorkspacesSwr } from "@/hooks/swr"
import { useWorkspaceId } from "@/hooks/workspaces"
import { navigation } from "@/modules/i18n"
import { APP_ROUTES, AUTH_ROUTES, workspaceHref, workspacePaymentPath, workspacesPath } from "@/modules/routes"
import { forgetWorkspaceCookie, rememberWorkspaceCookie } from "@/modules/storage"
import type { ConsoleSessionView } from "@/modules/types"
import { UNPAID_WORKSPACE_STATES } from "./console.shared"
import { useConsoleSessionRead } from "./useConsoleSessionRead"

/** What the console gate reads to decide whether the workspace of the address may be worked in. */
interface ConsoleExitInput {
    /** Every membership of the person; none while unread. */
    readonly memberships:
        | ReadonlyArray<{
              readonly workspace: { readonly id: string; readonly status: string }
              readonly member: { readonly status: string }
          }>
        | undefined
    readonly workspaceId: string
    /** The first workspace the back end made for a person who had none: its id, `null` when none was made, `undefined` while it is asked. */
    readonly first: string | null | undefined
}

/**
 * The person's own workspace to open instead of one that is not theirs: their only active workspace, else the workspaces page where they
 * pick one (several, or none active).
 */
const ownWorkspaceOf = (memberships: NonNullable<ConsoleExitInput["memberships"]>): string => {
    const active = memberships.filter((entry) => entry.member.status === "active")
    return active.length === 1 && active[0] !== undefined
        ? workspaceHref(active[0].workspace.id, APP_ROUTES.workspaceHome)
        : AUTH_ROUTES.workspaces
}

/**
 * Where the person leaves the console for, or `undefined` while it may stay: a person with no membership goes to their new first
 * workspace, or to the workspaces page when none was made; a workspace of the address that is not theirs (a remembered or linked id
 * from another database, deployment or person) falls back to their own workspaces, never a dead end; a disabled member goes to the
 * workspaces page; an unpaid workspace goes to its payment step.
 */
const consoleExitOf = (input: ConsoleExitInput): string | undefined => {
    const { memberships, workspaceId, first } = input
    if (memberships === undefined) return undefined
    if (memberships.length === 0) {
        if (first === undefined) return undefined
        return first === null ? workspacesPath("none") : workspaceHref(first, APP_ROUTES.workspaceHome)
    }
    const current = memberships.find((entry) => entry.workspace.id === workspaceId)
    if (current === undefined) return ownWorkspaceOf(memberships)
    if (current.member.status !== "active") return workspacesPath("disabled")
    return UNPAID_WORKSPACE_STATES.has(current.workspace.status) ? workspacePaymentPath(workspaceId) : undefined
}

/** The SWR session and whether the console may mount its readers. */
interface ConsoleGate {
    readonly session: ConsoleSessionView | undefined
    readonly isReady: boolean
}

/**
 * Whether the console frame may render for the workspace of the address: the session in it is read; a workspace the person is not a
 * member of is forgotten (the remembered id would lead back to it) and the person is sent to their own workspaces. A person with no membership at
 * all first gets their first workspace from the back end (created only where free signup is allowed: local and demo); when none is
 * created they are sent to the workspaces page, as is a disabled member. An unpaid workspace sends them to its payment step. A
 * workspace that opens is remembered, so the front address and the picker lead back to it.
 */
export const useConsoleGate = (): ConsoleGate => {
    const workspaceId = useWorkspaceId()
    const memberships = useQueryMyWorkspacesSwr()
    const session = useConsoleSessionRead()
    const router = navigation.useRouter()
    const isEmpty = memberships.data?.length === 0
    const first = useMutateStartFirstWorkspaceSwr(isEmpty)
    const exit = consoleExitOf({
        memberships: memberships.data,
        workspaceId,
        first: first.error === undefined ? first.data : null,
    })
    useEffect(() => {
        if (exit !== undefined) router.replace(exit)
    }, [exit, router])
    const isReady = session !== undefined && exit === undefined
    const isForeign =
        memberships.data !== undefined && !memberships.data.some((entry) => entry.workspace.id === workspaceId)
    useEffect(() => {
        if (isReady) rememberWorkspaceCookie(workspaceId)
        else if (isForeign) forgetWorkspaceCookie(workspaceId)
    }, [isReady, isForeign, workspaceId])
    return { session, isReady }
}
