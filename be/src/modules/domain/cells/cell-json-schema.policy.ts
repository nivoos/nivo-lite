import { Injectable } from "@nestjs/common"
import Ajv2020, { type ValidateFunction } from "ajv8/dist/2020"
import { canonicalJsonOf } from "./cell-hash.policy"
import type { JsonSchema, JsonValue } from "./cells.contracts"
import { CellsError, CellsErrorCode } from "./errors/cells.error"

/** How many compiled schemas the policy keeps; the oldest goes first. */
const COMPILED_LIMIT = 500

@Injectable()
/**
 * JSON Schema 2020-12 for cell inputs, outputs, configs and variables. The only file that touches the validator library, so nothing else
 * imports it. A compiled schema is kept by the canonical text of the schema.
 */
export class CellJsonSchemaPolicy {
    private readonly ajv = new Ajv2020({ allErrors: false, strict: true, strictTuples: false, validateFormats: false })
    private readonly compiled = new Map<string, ValidateFunction>()

    /**
     * The path of the first problem of a value against a schema (`/` for the root), or null when it fits. A schema the library cannot
     * compile throws `CELLS_SCHEMA_INVALID` for `ref`.
     */
    problemOf(ref: string, schema: JsonSchema, value: JsonValue): string | null {
        const validate = this.compile(ref, schema)
        if (validate(value)) return null
        return validate.errors?.[0]?.instancePath || "/"
    }

    /**
     * The first reason a value is not a schema the executor can use, as `<path>: <reason>`, or null: it must be a JSON Schema 2020-12 document
     * (the meta-schema) AND compile under the same strict settings the executor validates with, so a schema the seed accepts never fails at run
     * time. The ONE schema check of cells (the seed's validation and the graph's `vars` use it too).
     */
    schemaProblemOf(schema: unknown): string | null {
        if (typeof schema !== "boolean" && (typeof schema !== "object" || schema === null || Array.isArray(schema)))
            return "/: a schema is an object or true / false"
        if (this.ajv.validateSchema(schema as JsonSchema) !== true)
            return `/: ${this.ajv.errorsText(this.ajv.errors, { dataVar: "schema" })}`
        try {
            this.ajv.compile(schema as JsonSchema)
        } catch (cause: unknown) {
            // ajv throws an Error for a schema its strict mode refuses (an unknown keyword, a type mismatch of keywords)
            return `/: ${(cause as Error).message}`
        }
        return null
    }

    private compile(ref: string, schema: JsonSchema): ValidateFunction {
        const key = canonicalJsonOf(schema)
        const kept = this.compiled.get(key)
        if (kept !== undefined) return kept
        let validate: ValidateFunction
        try {
            validate = this.ajv.compile(schema)
        } catch (cause: unknown) {
            throw new CellsError({ code: CellsErrorCode.SchemaInvalid, params: { ref, path: "/" }, cause })
        }
        if (this.compiled.size >= COMPILED_LIMIT) {
            const oldest = this.compiled.keys().next()
            if (oldest.done !== true) this.compiled.delete(oldest.value)
        }
        this.compiled.set(key, validate)
        return validate
    }
}
