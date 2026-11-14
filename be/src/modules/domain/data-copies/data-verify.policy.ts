import type { CopyRef, CopyVerdict, DataManifest, DriverAdapter, VerifyCheck } from "@modules/integrations/seed"
import type { DataVerifyReceipt, DriverVerification } from "./data-copies.contracts"

/** True when the restored export holds the set a copy promises, with the same digest and the same item count. */
const restoredAs = (promised: DataManifest["sets"][number], restored: DataManifest): boolean => {
    const found = restored.sets.find(
        (candidate) => candidate.store === promised.store && candidate.set === promised.set,
    )
    return found?.digest === promised.digest && found.items === promised.items
}

/** The sets of a copy whose restored export differs from what the copy's manifest promises (a missing set, another digest or another item count): `<store>/<set>`. */
export const restoreMismatches = (copy: DataManifest, restored: DataManifest): ReadonlyArray<string> =>
    copy.sets
        .filter((promised) => !restoredAs(promised, restored))
        .map((promised) => `${promised.store}/${promised.set}`)

/** The restore check of a copy: it passes when the scratch import was whole and the scratch export equals the manifest. */
export const restoreCheckOf = (differing: ReadonlyArray<string>, refused: boolean): VerifyCheck => {
    const ok = !refused && differing.length === 0
    const suffix = refused ? " (an import was refused)" : ""
    const detail = ok ? "scratch export equals the manifest" : `differs: ${differing.join(", ")}${suffix}`
    return { name: "restore", ok, detail }
}

/** What a driver holding no copy says: nothing to verify, one finding. */
export const missingCopyOf = (driver: DriverAdapter): DriverVerification => ({
    verdict: null,
    copy: null,
    findings: [`${driver.id}: DATA_COPY_MISSING`],
})

/** What the verify of one copy found: the driver's checks, then the restore check when it was made. */
export const verificationOf = (
    driver: DriverAdapter,
    ref: CopyRef,
    verdict: CopyVerdict,
    restore: VerifyCheck | null,
): DriverVerification => {
    const checks = restore === null ? verdict.checks : [...verdict.checks, restore]
    const failed = checks.filter((check) => !check.ok)
    const healthy = failed.length === 0
    const names = failed.map((check) => check.name).join(",")
    return {
        verdict,
        copy: { driver: driver.id, ref: ref.locator, exportDigest: ref.exportDigest, healthy, checks },
        findings: healthy ? [] : [`${driver.id}: failed ${names}`],
    }
}

/** The receipt of the verify of one set from what each driver found and the sets in which the copies differ. */
export const verifyReceiptOf = (
    setId: string,
    at: string,
    verifications: ReadonlyArray<DriverVerification>,
    differing: ReadonlyArray<string>,
): DataVerifyReceipt => {
    const findings = [
        ...verifications.flatMap((found) => found.findings),
        ...(differing.length > 0 ? [`copies differ in ${differing.join(",")}`] : []),
    ]
    const copies = verifications.flatMap((found) => (found.copy === null ? [] : [found.copy]))
    return { setId, at, healthy: findings.length === 0, copies, findings }
}

/** The reason of the one failure a verify ends with: the sets with findings, each with its findings. */
export const verifyProblemsOf = (receipts: ReadonlyArray<DataVerifyReceipt>): string => {
    const sick = receipts
        .filter((receipt) => !receipt.healthy)
        .map((receipt) => [receipt.setId, receipt.findings.join("; ")].join(": "))
    return `verify found problems: ${sick.join(" | ")}`
}
