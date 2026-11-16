// The ONE-SHOT that changes the seeded owner account's sign-in address IN PLACE in a deployed environment (SEED-HOOK 2026-11-15).
// The seed made the owner account from WORKSPACE_OWNER_EMAIL of the sealed member seeds-nivo-workspace; when the owner reseals another
// address, a forced seed would look the NEW address up, make a second account and find no workspace it owns. This keeps the ONE account
// (its id, so every workspace it owns and every membership) and only changes its address, through the app's own door:
//   1. OLD address = the member as COMMITTED at HEAD (`git show HEAD:<file>`, the sealed text, decrypted in memory); NEW address = the
//      member in the working tree (the owner's uncommitted reseal), decrypted in memory. Only WORKSPACE_OWNER_EMAIL is kept of each.
//   2. both go as one JSON line `{from, to}` on the STDIN of `cli create-owner rename [--dry]` inside the running jobs task
//      (`deploy.jobs.service`, nivo-api), over the harness's own ssh runner: never on a command line.
// Nothing here prints, logs or writes an address: the dry run prints only "old account exists: yes/no; new address free: yes/no".
// After `--execute`, commit the member file (the owner's reseal) so HEAD and the working tree agree; then the forced seed finds the owner.
//   node scripts/owner-rename-oneshot.mjs --env production --dry
//   node scripts/owner-rename-oneshot.mjs --env production --execute
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const ROOT = process.cwd()
const require = createRequire(path.join(ROOT, "package.json"))
const HFS = path.dirname(require.resolve("@starci/hfs/package.json"))
const hfs = (file) => import(pathToFileURL(path.join(HFS, file)).href)

const MEMBER = "seeds-nivo-workspace"
const EMAIL_KEY = "WORKSPACE_OWNER_EMAIL"

/** The environment's identity as the harness CLI looks it up (its secret.env, then the harness home's); never printed. */
const identityOf = async () => {
    const home = process.env.STARCI_HARNESS_HOME ?? path.join(path.parse(ROOT).root, ".claude")
    const { hostAgeIdentity } = await import(pathToFileURL(path.join(home, "cli", "dist", "harness", "secret-env.js")).href)
    return hostAgeIdentity(ROOT)
}

const main = async () => {
    const args = process.argv.slice(2)
    const env = args[args.indexOf("--env") + 1]
    const execute = args.includes("--execute")
    if (args.indexOf("--env") === -1 || env === undefined || (!execute && !args.includes("--dry"))) {
        console.error("usage: node scripts/owner-rename-oneshot.mjs --env <env> --dry | --execute")
        process.exit(2)
    }
    const identity = await identityOf()
    if (identity.read() === undefined) throw new Error("no age identity of this machine (the harness's secret.env)")
    const { stackContext } = await hfs("stack/context.mjs")
    const { loadDeployConfig } = await hfs("stack/config.mjs")
    const { withRunner } = await hfs("stack/remote.mjs")
    const { seedMemberFile } = await hfs("runtime/scripts/hfs/stack-seeds-config.mjs")
    const { envelopeOf } = await hfs("runtime/scripts/hfs/secret-document.mjs")
    const ctx = stackContext({ hostIdentity: identity })
    const relative = seedMemberFile(env, MEMBER).replaceAll("\\", "/")
    const addressOf = (file) => {
        const values = ctx.sops.decrypt(file, envelopeOf(fs.readFileSync(file, "utf8")).format)
        return typeof values[EMAIL_KEY] === "string" ? values[EMAIL_KEY].trim() : ""
    }
    // The committed member: its SEALED text copied to a private temporary file (ciphertext only), opened in memory, removed at once.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-rename-"))
    let from = ""
    try {
        const committed = path.join(dir, path.basename(relative))
        fs.writeFileSync(committed, execFileSync("git", ["show", `HEAD:${relative}`], { cwd: ROOT }), { mode: 0o600 })
        from = addressOf(committed)
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
    const to = addressOf(path.join(ROOT, relative))
    console.log(`${EMAIL_KEY} committed: ${from ? "sealed" : "absent"}; working tree: ${to ? "sealed" : "absent"}; they differ: ${from && to && from.toLowerCase() !== to.toLowerCase() ? "yes" : "no"}`)
    if (!from || !to) throw new Error(`${MEMBER} lacks ${EMAIL_KEY} at HEAD or in the working tree: nothing was sent`)
    const config = loadDeployConfig({ repoRoot: ROOT, env })
    const service = config.jobs?.service
    if (service === undefined) throw new Error(`${env} declares no deploy.jobs service`)
    const status = await withRunner(ctx, config, {}, {}, (run) => {
        const found = run(`docker ps -q --filter label=com.docker.swarm.service.name=${config.stack}_${service} --filter status=running`)
        const task = String(found.stdout ?? "").trim().split("\n")[0]
        if (!task) throw new Error(`no running task of ${config.stack}_${service}`)
        console.log(`task: ${config.stack}_${service} (${task.slice(0, 12)})`)
        const result = run(`docker exec -i ${task} node be/dist/apps/cli/src/main.js create-owner rename${execute ? "" : " --dry"}`, { input: `${JSON.stringify({ from, to })}\n` })
        process.stdout.write(String(result.stdout ?? ""))
        if (result.status !== 0) console.error(`the task's command exited ${String(result.status)} (its error output is withheld: it may hold the addresses)`)
        return result.status
    })
    process.exit(status === 0 ? 0 : 1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((cause) => {
    console.error(`owner-rename-oneshot: ${String(cause?.message ?? cause).slice(0, 300)}`)
    process.exit(1)
})
