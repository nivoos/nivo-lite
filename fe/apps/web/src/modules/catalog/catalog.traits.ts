import type { ModuleCopy } from "./catalog.types"

/** Whether an agent of this type answers customers: every type the catalogue does not mark `internal` (also while the catalogue loads). */
export const answersCustomersOf = (copy: ModuleCopy | undefined): boolean => copy?.audience !== "internal"

/** Whether the general settings of this type carry the reply limits of the chatbot (the type declares the extras `chatbot_reply`). */
export const hasReplyLimitsOf = (copy: ModuleCopy | undefined): boolean => copy?.settingsExtras === "chatbot_reply"
