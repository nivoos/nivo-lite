import type { DocHeadView } from "@/modules/types"

/** The area command of a document still being read: the same shape as a ready one, so the loading head is the ready head. */
export const DOC_AREA_PLACEHOLDER: NonNullable<DocHeadView["area"]> = {
    label: "-",
    isPending: false,
    confirm: { title: "-", description: "-", confirmLabel: "-", cancelLabel: "-" },
}
