import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * THE MODEL PROVIDER'S SANDBOX COVERAGE (SBX standard 2026-11-15). The model plays one role, `model`, over ONE operation `call` (every model
 * call of the workspace; a case may be picked per purpose too). The wire is the endpoint's own (`AiRunner`), read by NIVO's model door
 * unchanged. MODEL-1 stays the DEFAULT and passes to the REAL endpoint (decided: a workspace is walked with the real model behind sandbox
 * channels; it is tagged `ok` and meets the gate); MODEL-8 and MODEL-9 never reach an endpoint.
 */
export const MODEL_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "model",
    roles: [
        {
            role: "model",
            operation: "call",
            covers: {
                // MODEL-8: a chat call gets the smallest value of the asked schema (JSON Schema or zod); an agent turn gets `done` with the `done`
                // tool's own output (the step's output schema is not on the model's wire).
                "model.answer": { cases: ["MODEL-8"] },
                // MODEL-9: an agent turn calls the first tool the request offered with the smallest arguments its schema allows.
                "model.tool_call": { cases: ["MODEL-9"] },
                "model.refusal": { cases: ["MODEL-2"] },
                "model.malformed": { cases: ["MODEL-3"] },
                "model.too_long": { cases: ["MODEL-10"] },
                "model.rate_limited": { cases: ["MODEL-11"] },
                "model.timeout": { cases: ["MODEL-4"] },
                "model.unavailable": { cases: ["MODEL-5"] },
                "model.cut": { cases: ["MODEL-6"] },
                "model.cannot": { cases: ["MODEL-7"] },
            },
        },
    ],
}
