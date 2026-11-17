import { z } from "zod"

/** What a customer-line send answers: `sent` false when the channel refused it (a member holds the route, or the contact was erased); `refusal` is then the code. Nothing went out. */
export const SentOutput = z.strictObject({ sent: z.boolean(), refusal: z.string().max(60) })
