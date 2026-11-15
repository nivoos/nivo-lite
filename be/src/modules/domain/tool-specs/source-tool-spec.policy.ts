import type { PinnedOperation } from "@modules/domain/openapi-tools"
import type { ToolDataKind, ToolSpec } from "./tool-specs.contracts"

/** What the spec of a source's operation is read from: the source the plugin declares and the operation of its pinned document. */
export interface SourceOperation {
    /** The source key the plugin declares (`crm`): the owner of every tool of the source. */
    readonly source: string
    /** The kind of data the source's reads reach (the plugin's declaration), or null when none is declared. */
    readonly dataKind: ToolDataKind | null
    /** The operation's HTTP method: every method but GET writes. */
    readonly method: PinnedOperation["method"]
    /** The effect the document marks (`x-nivo-effect`), or null when it marks none. */
    readonly effect: PinnedOperation["effect"]
    /** True when the document declares the operation takes the provider's replay key (`takesReplayKey`). */
    readonly replayKeyed: boolean
}

/**
 * The spec of a tool a SOURCE generates (`nivo.tool.<source>.<method>.<path>`, or a purpose its document marks), from the pinned
 * document: a GET reads (every held account, the source's data kind); any other method writes (ONE account of the node's list). Its
 * money / irreversible mark is display only (nivo-frame `rights`). The owner is the source key. Its refusals are the provider's answers
 * to a call, free text: an open set. It is `repeatable` when a read, or when the document declares that the write takes the provider's
 * replay key (the system's own contract: a second call under the same key answers the first one's result and acts once; NWC-LEAD,
 * OQ-N2), so an unknown outcome is made again AS RECORDED under its key (E-FIX12 A-2); any other write is not, and stops for a person. A
 * source declares no `confirmBy` and no final refusal: the document states neither.
 */
export const sourceToolSpecOf = (operation: SourceOperation): ToolSpec => {
    const reads = operation.method === "GET"
    return {
        mutates: !reads,
        owners: [operation.source],
        account: reads ? "each" : "any",
        dataKind: operation.dataKind,
        onceBy: [],
        refusals: { closed: false, codes: [] },
        // A read may be asked again; a write only when the system replays its key (else never sent again by itself: R74).
        repeatable: reads || operation.replayKeyed,
    }
}
