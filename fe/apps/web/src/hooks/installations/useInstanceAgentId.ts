"use client"

import { useInstanceGuard } from "./useInstanceGuard"

/** The agent that drives one instance of an agent url, or null while the instance is read, unknown, or has no agent yet. */
export const useInstanceAgentId = (module: string, installationId: string): string | null =>
    useInstanceGuard(module, installationId).installation?.agentId ?? null
