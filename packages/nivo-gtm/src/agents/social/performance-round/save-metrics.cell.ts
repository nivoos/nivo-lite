import { z } from "zod"
import type { NivoRef, Node, NodeReach } from "@starci/nivoos-sdk"
import { Publication } from "../../../objects/publication.object.ts"
import { keyOf } from "../../../package-key.ts"
import { PullOutput } from "./pull.cell.ts"

export const SaveMetricsInput = z.strictObject({ items: PullOutput.shape.items })
export const SaveMetricsOutput = z.strictObject({ saved: z.number().int() })

type In = z.infer<typeof SaveMetricsInput>
type Out = z.infer<typeof SaveMetricsOutput>

/**
 * `nivo-gtm.social-save-metrics` (Lưu số liệu): one act, `object.update` of every publication pulled, with the numbers and `metricsAt` stamped now. Until a provider reads real numbers the values are the ones the object holds,
 * so this keeps the stamp honest: when the numbers were last looked at.
 */
export class SocialSaveMetrics implements Node<typeof SaveMetricsInput, typeof SaveMetricsOutput> {
    readonly key = keyOf("social-save-metrics")
    readonly version = 1
    readonly title = { vi: "Lưu số liệu", en: "Save the numbers" }
    readonly input = SaveMetricsInput
    readonly output = SaveMetricsOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        let saved = 0
        for (const item of input.items) {
            const got = reach.objects(Publication).get(item.id as NivoRef<Publication>)
            if (got.error) throw got.error
            const { error } = reach.objects(Publication).update({
                id: got.result.id,
                version: got.result.version,
                values: { views: item.views, reach: item.reach, engagements: item.engagements, clicks: item.clicks, leads: item.leads, metricsAt: reach.facts.at },
            })
            if (error) throw error
            saved += 1
        }
        return { saved }
    }
}
