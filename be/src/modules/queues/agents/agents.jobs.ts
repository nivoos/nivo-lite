import { defineJob, type JobDefinition, type JobEffectDeclaration } from "@modules/platform/jobs"
import {
    AGENTS_QUEUE,
    AgentsJob,
    agentsDedupeKey,
    isGenerateWithAgentPayload,
    isSetupTurnPayload,
    type GenerateWithAgentPayload,
    type SetupTurnPayload,
} from "./agents.contracts"

/**
 * The outside effect of the model call of one queued generation: a paid call that changes nothing outside. Its answer (the text and what
 * it cost) is KEPT on the ledger row, so a run again after a crash between the answer and its save answers from the ledger and never
 * bills the model twice; a lost outcome is made again under the same key.
 */
export const GENERATE_MODEL_EFFECT: JobEffectDeclaration = { name: "agents.generate", settle: "repeatable" }

/**
 * The run of one queued generation. The caller of a queued text polls the row and gives up at its own deadline (5 to 120 s), so a
 * pause of minutes would answer nobody: `background` (5 / 10 / 20 s). The once key is the dedupe key the producer always wrote.
 */
export const GENERATE_JOB: JobDefinition<GenerateWithAgentPayload> = defineJob<GenerateWithAgentPayload>({
    name: AgentsJob.Generate,
    queue: AGENTS_QUEUE,
    ladder: "background",
    payload: isGenerateWithAgentPayload,
    onceKey: (payload) => agentsDedupeKey(AgentsJob.Generate, payload.generationId),
    next: [],
    effects: [GENERATE_MODEL_EFFECT],
})

/**
 * The answer to one owner message of the setup chat: the owner waits for the reply, so it is on the `waited` ladder. One job per message.
 * Its one model call is a generation run in the job's own process (`GenerationsService.generate`, key `<jobId>:turn`), so its effect is
 * the generation's.
 */
export const SETUP_TURN_JOB: JobDefinition<SetupTurnPayload> = defineJob<SetupTurnPayload>({
    name: AgentsJob.SetupTurn,
    queue: AGENTS_QUEUE,
    ladder: "waited",
    payload: isSetupTurnPayload,
    onceKey: (payload) => agentsDedupeKey(AgentsJob.SetupTurn, payload.messageId),
    next: [],
    effects: [GENERATE_MODEL_EFFECT],
})
