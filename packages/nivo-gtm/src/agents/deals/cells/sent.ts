import { z } from "zod"

/** What a customer-line send answers: where it went. A refusal of the channel (held route, erased contact) is handed up by the cell and routed by the step. */
export const SentOutput = z.strictObject({ channel: z.string().max(20), to: z.string().max(200) })
