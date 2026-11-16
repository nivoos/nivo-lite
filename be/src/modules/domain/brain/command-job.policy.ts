import { isKnowledgeCommandPayload, type KnowledgeCommandPayload } from "@modules/queues/knowledge"

/** The payload of a brain command job that carries a command row, or null for the shape of the upkeep jobs. */
export const commandPayloadOf = (payload: object): KnowledgeCommandPayload | null =>
    isKnowledgeCommandPayload(payload) ? payload : null
