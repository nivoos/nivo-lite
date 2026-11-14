/** The JSON of a value with its object keys sorted, so equal data always has the same text and the same hash. */
export const canonicalJson: (value: unknown) => string = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map((item: unknown) => canonicalJson(item)).join(",")}]`
    if (typeof value === "object" && value !== null) {
        return `{${Object.entries(value)
            .filter(([, member]) => member !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, member]) => `${JSON.stringify(name)}:${canonicalJson(member)}`)
            .join(",")}}`
    }
    return JSON.stringify(value) ?? "null"
}
