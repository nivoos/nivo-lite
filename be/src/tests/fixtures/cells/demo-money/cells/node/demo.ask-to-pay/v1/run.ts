import type { NodeContext } from "@nivo-lite/cells-author"

interface Input { readonly orderId: string; readonly total: number }
interface Output { readonly payKey: string }

export function run(input: Input, ctx: NodeContext): Output {
  const asked = ctx.tool("nivo.tool.payment.request.create", { amountVnd: input.total, reference: input.orderId })
  if (!asked.ok) return ctx.cannot("payment request refused: " + asked.refusal)
  ctx.tool("nivo.tool.customer.message.send", { text: ctx.say("ask the customer to pay", asked.value) })
  return { payKey: asked.value.payKey }
}
