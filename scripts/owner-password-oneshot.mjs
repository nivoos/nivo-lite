// The ONE-SHOT that gives the seeded owner account of a deployed environment the password its owner sealed (OWNER-PASS 2026-11-15).
// The seed makes the owner account (WORKSPACE_OWNER_EMAIL of the sealed member seeds-nivo-workspace) confirmed, with a password nobody
// knows. The owner seals the password he chose himself, typed into the harness's masked prompt, as WORKSPACE_OWNER_PASSWORD of the
// same member:
//   starci app secret set --env production seeds-nivo-workspace WORKSPACE_OWNER_PASSWORD
// This script then sets it through the app's own door, in the app's own process, the way the seed one-shot reaches the running api:
//   1. the member is opened IN MEMORY on the operator's machine with the harness's sops seam and the environment's identity; only
//      WORKSPACE_OWNER_EMAIL and WORKSPACE_OWNER_PASSWORD are kept;
//   2. they go as one JSON line on the stdin of `node -e <loader>` inside the running jobs task (`deploy.jobs.service`, nivo-api), over
//      the harness's own ssh runner. The loader (no value in it) reads stdin and, in that process:
//        --dry      boots the cli module graph and asks OwnersService.findAccount whether the address has an account (reads only);
//        --execute  checks the same, then runs the cli's own command `create-owner run --email … --password …` IN PROCESS: the values
//                   are put into that process's argument array in memory, never onto a command line of any process (ps shows only
//                   `node -e <loader>`), so `createOwner` sets the password through public.be_auth_set_password.
// Nothing here prints, logs or writes a value: the address is never printed, the password only ever lives in memory; the task's error
// output is withheld. `--execute` refuses when the key is not sealed, the password breaks the rule, or the address has no account.
//   node scripts/owner-password-oneshot.mjs --env production --dry       what it would do (writes nothing)
//   node scripts/owner-password-oneshot.mjs --env production --execute   sets the password
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const ROOT = process.cwd()
const require = createRequire(path.join(ROOT, "package.json"))
const HFS = path.dirname(require.resolve("@starci/hfs/package.json"))
const hfs = (file) => import(pathToFileURL(path.join(HFS, file)).href)

const MEMBER = "seeds-nivo-workspace"
const EMAIL_KEY = "WORKSPACE_OWNER_EMAIL"
const PASSWORD_KEY = "WORKSPACE_OWNER_PASSWORD"

/** The loader run in the api task: no value in it; it reads `{execute, email, password?}` from stdin. Prints only fixed words. */
const LOADER = `
const path = require("path")
const root = process.cwd()
const dist = (file) => require(path.join(root, "be", "dist", file))
const fail = (word) => { console.log("refused: " + word); process.exit(1) }
const chunks = []
process.stdin.on("data", (chunk) => chunks.push(chunk))
process.stdin.on("end", async () => {
  let input
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { fail("input_not_json") }
  try {
    const { CommandFactory } = require(require.resolve("nest-commander", { paths: [path.join(root, "be", "dist", "apps", "cli", "src")] }))
    const { AppModule } = dist("apps/cli/src/app.module.js")
    const { readCliEnv } = dist("apps/cli/src/cli.env.js")
    const { EnvSource } = dist("src/modules/platform/config/index.js")
    const { OwnersService } = dist("src/modules/domain/owners/index.js")
    const app = await CommandFactory.createWithoutRunning(AppModule.register(readCliEnv(EnvSource.fromProcess())), { logger: ["error", "warn"] })
    const account = await app.get(OwnersService, { strict: false }).findAccount(input.email)
    await app.close()
    console.log("account exists: " + (account ? "yes" : "no"))
    if (!input.execute) process.exit(0)
    if (!account) fail("no_account")
    if (typeof input.password !== "string" || input.password.length === 0) fail("no_password")
    process.argv = [process.argv[0], path.join(root, "be/dist/apps/cli/src/main.js"), "create-owner", "run", "--email", input.email, "--password", input.password]
    input = undefined
    dist("apps/cli/src/main.js")
  } catch (cause) {
    console.log("failed: " + String((cause && (cause.code || cause.name)) || "error"))
    process.exit(1)
  }
})
`

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
        console.error("usage: node scripts/owner-password-oneshot.mjs --env <env> --dry | --execute")
        process.exit(2)
    }
    const identity = await identityOf()
    if (identity.read() === undefined) throw new Error("no age identity of this machine (the harness's secret.env)")
    const { stackContext } = await hfs("stack/context.mjs")
    const { loadDeployConfig } = await hfs("stack/config.mjs")
    const { withRunner } = await hfs("stack/remote.mjs")
    const { seedMemberFile } = await hfs("runtime/scripts/hfs/stack-seeds-config.mjs")
    const { envelopeOf } = await hfs("runtime/scripts/hfs/secret-document.mjs")
    const { isAcceptablePassword } = await import("@starci/auth/server")
    const ctx = stackContext({ hostIdentity: identity })
    const member = path.join(ROOT, seedMemberFile(env, MEMBER))
    const values = ctx.sops.decrypt(member, envelopeOf(fs.readFileSync(member, "utf8")).format)
    const email = typeof values[EMAIL_KEY] === "string" ? values[EMAIL_KEY] : ""
    const password = typeof values[PASSWORD_KEY] === "string" ? values[PASSWORD_KEY] : ""
    const acceptable = password.length > 0 && isAcceptablePassword(password)
    console.log(`would set the password of the account whose address is ${EMAIL_KEY} (${MEMBER}, ${env})`)
    console.log(`${EMAIL_KEY} sealed: ${email ? "yes" : "no"}`)
    console.log(`${PASSWORD_KEY} sealed: ${password ? "yes" : "no"}${password ? `, meets the rule: ${acceptable ? "yes" : "no"}` : ""}`)
    if (!email) throw new Error(`${MEMBER} holds no ${EMAIL_KEY}`)
    if (execute && !acceptable) throw new Error(`${PASSWORD_KEY} is ${password ? "sealed but breaks the rule (8+ characters, at most 72 bytes)" : "not sealed"}: nothing was sent`)
    const input = `${JSON.stringify(execute ? { execute: true, email, password } : { execute: false, email })}\n`
    const config = loadDeployConfig({ repoRoot: ROOT, env })
    const service = config.jobs?.service
    if (service === undefined) throw new Error(`${env} declares no deploy.jobs service`)
    const loader = Buffer.from(LOADER, "utf8").toString("base64")
    const status = await withRunner(ctx, config, {}, {}, (run) => {
        const found = run(`docker ps -q --filter label=com.docker.swarm.service.name=${config.stack}_${service} --filter status=running`)
        const task = String(found.stdout ?? "").trim().split("\n")[0]
        if (!task) throw new Error(`no running task of ${config.stack}_${service}`)
        console.log(`task: ${config.stack}_${service} (${task.slice(0, 12)})`)
        const result = run(`docker exec -i ${task} node -e "eval(Buffer.from('${loader}','base64').toString('utf8'))"`, { input })
        process.stdout.write(String(result.stdout ?? ""))
        if (result.status !== 0) console.error(`the task's command exited ${String(result.status)} (its error output is withheld: it may hold the opened values)`)
        return result.status
    })
    process.exit(status === 0 ? 0 : 1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((cause) => {
    console.error(`owner-password-oneshot: ${String(cause?.message ?? cause).slice(0, 300)}`)
    process.exit(1)
})
