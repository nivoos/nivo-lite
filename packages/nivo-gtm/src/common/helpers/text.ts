// Small pure helpers the cells inline (the compiler copies each helper a cell references into its stored text). No package import here: a stored cell imports nothing.

/** An ISO instant `hours` after `at` (an ISO instant). */
export const plusHours = (at: string, hours: number): string => new Date(Date.parse(at) + hours * 3600000).toISOString()

/** `1490000` as `1.490.000đ`. */
export const money = (amount: number): string => {
    const digits = String(Math.round(amount))
    let out = ""
    for (let index = 0; index < digits.length; index += 1) {
        if (index > 0 && (digits.length - index) % 3 === 0) out += "."
        out += digits[index]
    }
    return `${out}đ`
}
