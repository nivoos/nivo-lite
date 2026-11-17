import { z } from "zod"
import type { NivoRef, Node, NodeReach } from "@starci/nivoos-sdk"
import { Publication } from "../../../objects/publication.object.ts"
import { keyOf } from "../../../package-key.ts"
import { FileSlotsOutput } from "./file-slots.cell.ts"

export const ScheduleInput = z.strictObject({ filed: FileSlotsOutput.shape.filed, status: z.enum(["scheduled", "cancelled"]) })
export const ScheduleOutput = z.strictObject({ moved: z.number().int(), status: z.string() })

type In = z.infer<typeof ScheduleInput>
type Out = z.infer<typeof ScheduleOutput>

/**
 * `nivo-gtm.social-schedule` (Chốt lịch tuần): one act, `object.update` of every publication of the week to `scheduled` (the person approved the week; each write opens the `publish` workflow) or to `cancelled` (the person
 * asked for a change: nothing goes out).
 */
export class SocialSchedule implements Node<typeof ScheduleInput, typeof ScheduleOutput> {
    readonly key = keyOf("social-schedule")
    readonly version = 1
    readonly title = { vi: "Chốt lịch tuần", en: "Settle the week" }
    readonly input = ScheduleInput
    readonly output = ScheduleOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        let moved = 0
        for (const row of input.filed) {
            const got = reach.objects(Publication).get(row.id as NivoRef<Publication>)
            if (got.error) throw got.error
            const { error } = reach.objects(Publication).update({
                id: got.result.id,
                version: got.result.version,
                values: input.status === "scheduled" ? { status: "scheduled", nextAction: "Đăng đúng giờ" } : { status: "cancelled", nextAction: null },
            })
            if (error) throw error
            moved += 1
        }
        return { moved, status: input.status }
    }
}
