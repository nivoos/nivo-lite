import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import { money } from "../../../common/helpers/text.ts"
import { keyOf } from "../../../package-key.ts"

export const RequestActivationInput = z.strictObject({
    code: z.string().min(1).max(40),
    leadName: z.string().max(120),
    plan: z.string().max(60),
    months: z.number().int(),
    amount: z.number(),
})
export const RequestActivationOutput = z.strictObject({ messageId: z.string(), roomId: z.string() })
/** The person who activates a paid plan (a member id or name); empty asks the whole room. Placeholder: Minh Trần. */
export const RequestActivationSettings = z.strictObject({ activator: z.string().max(80).default("Minh Trần") })

type In = z.infer<typeof RequestActivationInput>
type Out = z.infer<typeof RequestActivationOutput>
type Settings = z.infer<typeof RequestActivationSettings>

/**
 * `nivo-gtm.request-activation` (Nhờ người kích hoạt gói): the activation is a PERSON'S step (until the platform is a provider, G8). One act, `room.message.post` of a card to the activator with the
 * workspace, plan and months to set up, and the choices `done` (Đã kích hoạt) and `stuck` (Chưa làm được).
 */
export class RequestActivation implements Node<typeof RequestActivationInput, typeof RequestActivationOutput, typeof RequestActivationSettings> {
    readonly key = keyOf("request-activation")
    readonly version = 1
    readonly title = { vi: "Nhờ người kích hoạt gói", en: "Ask a person to activate the plan" }
    readonly input = RequestActivationInput
    readonly output = RequestActivationOutput
    readonly settings = RequestActivationSettings
    readonly reads = []
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach<Settings>): Out {
        const text =
            `Đơn ${input.code} đã thu tiền ${money(input.amount)}. Kích hoạt gói cho ${input.leadName === "" ? "khách" : input.leadName}:\n` +
            `Gói ${input.plan === "" ? "Vận hành" : input.plan}, ${String(input.months < 1 ? 1 : input.months)} tháng. Tạo hoặc nâng workspace của khách trong trang quản trị rồi bấm "Đã kích hoạt".`
        const { result, error } = reach.call<RoomMessagePost>("room.message.post", {
            text,
            choices: [
                { value: "done", label: "Đã kích hoạt" },
                { value: "stuck", label: "Chưa làm được" },
            ],
            ...(reach.settings.activator === "" ? {} : { audience: [reach.settings.activator] }),
        })
        if (error) throw error
        return { messageId: result.messageId, roomId: result.roomId }
    }
}
