/**
 * The provider seam of the Studio agent: the operations the plan names that no catalogue provider carries for a business package yet. Each names the account and the operation a later provider fills; nothing here is
 * implemented, and every flow that would use one continues by the person path and says "chờ kết nối".
 */
export const PENDING_DRIVE_STATUS = "Drive: chờ kết nối"

export const PENDING_OPERATIONS = [
    {
        account: "drive-marketing",
        operation: "google-drive.files.create",
        use: "make the shoot folder and the shot list document",
        status: PENDING_DRIVE_STATUS,
    },
    {
        account: "drive-marketing",
        operation: "google-drive.file.added",
        use: "see the cut land in the folder (poll)",
        status: PENDING_DRIVE_STATUS,
    },
    {
        account: "media-vendor",
        operation: "media.start",
        use: "path B: a generated video (decision D3)",
        status: "chờ quyết định D3",
    },
] as const
