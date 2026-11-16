import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { ZALO_WIZARD_JOB, ZALO_WIZARD_QUEUE, isZaloWizardPayload, zaloWizardKey, type ZaloWizardPayload } from "./zalo-wizard.queue"

/**
 * One step of the Zalo connection wizard (seal the app keys, seal the OA Secret Key, or build the permission URL). The owner waits on the
 * screen (`waited`). It makes no outside call: it writes the sealed credential or the stored verifier, then the result next to the
 * ticket. The same step run again finds the verifier it stored and the result it wrote and changes nothing.
 */
export const RUN_ZALO_WIZARD_JOB: JobDefinition<ZaloWizardPayload> = defineJob<ZaloWizardPayload>({
    name: ZALO_WIZARD_JOB,
    queue: ZALO_WIZARD_QUEUE,
    ladder: "waited",
    payload: isZaloWizardPayload,
    onceKey: zaloWizardKey,
    next: [],
    effects: [],
})
