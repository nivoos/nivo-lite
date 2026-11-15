import type { ModulesCatalogQuery } from "@/modules/api"

// The key of one module (one agent type) is an opaque `string`: the host app holds no package's key. What exists for a workspace is
// what the back end serves that workspace (public plugins plus the private plugins of its enterprise).

/**
 * One module as the catalogue the back end serves a workspace describes it: copy in both languages, the mark, the category, the
 * providers it works through, its setup gates and its flags. Every per-module fact the screens need is a field of this row.
 */
export type ModuleCopy = ModulesCatalogQuery["modulesCatalog"]["modules"][number]
/** A setup gate with its backend-owned display copy. */
export type RegistryGate = ModuleCopy["gates"][number]
/** A text in both product languages. */
export type Bilingual = { readonly vi: string; readonly en: string }
/** A list of texts in both product languages. */
export type BilingualList = { readonly vi: ReadonlyArray<string>; readonly en: ReadonlyArray<string> }

/** The modules a workspace can name, as one choice list: key and full name in the reader language, in the catalogue's display order. */
export type ModuleChoices = ReadonlyArray<{ readonly id: string; readonly label: string }>

/** The full name of a module in the reader language, or null when the catalogue served this workspace no such module. */
export type ModuleLabelOf = (key: string | null | undefined) => string | null
