interface Raw { readonly id: string; readonly amount: number; readonly content: string }

export function translate(raw: Raw) {
  return { creditId: raw.id, amountVnd: raw.amount, content: raw.content }
}
