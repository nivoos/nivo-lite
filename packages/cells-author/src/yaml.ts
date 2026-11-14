import { stringify } from "yaml"

/** The one YAML text of a data file: keys sorted at every level, no line folding, two-space indent, LF, exactly one trailing newline. Same value, same bytes. */
export const yamlOf = (value: unknown): string => `${stringify(value, { sortMapEntries: true, lineWidth: 0, indent: 2 }).trimEnd()}\n`
