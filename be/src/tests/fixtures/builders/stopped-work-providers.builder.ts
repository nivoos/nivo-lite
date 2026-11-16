import type { Provider } from "@nestjs/common"
import { JOB_DEAD_LETTERS, JobDeadLettersService, PARKED_JOB_RESUMER, type ParkedJobResumerService } from "@modules/platform/jobs"

/** The real dead-letter registry, provided under the token capabilities inject it by. */
export const deadLettersProviders: ReadonlyArray<Provider> = [
    JobDeadLettersService,
    { provide: JOB_DEAD_LETTERS, useExisting: JobDeadLettersService },
]

/** The parked-job resumer a spec hands the person's door, provided under the token the door injects it by. */
export const parkedJobResumerProvider = (resumer: ParkedJobResumerService): Provider => ({
    provide: PARKED_JOB_RESUMER,
    useValue: resumer,
})
