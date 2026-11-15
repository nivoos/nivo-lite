// The ONE-SHOT seed of the seed standards in a deployed environment (PROD-WIRE 2026-11-15; concept seeds-and-data rule 9 + 17).
// It runs the standards' apply WITHOUT a deploy. A deployed api image holds no git, no sops and no age identity, so each standard is
// MATERIALISED HERE, on the operator's machine:
//   1. the environment's declarations (`.starcistacks/<env>/seeds/data/seed-standards/*.json`) are read; an `owner: {secret: <member>}` is
//      opened in memory with the harness's sops seam and the environment's identity, and only its WORKSPACE_OWNER_EMAIL is kept;
//   2. each repository is pinned at its declared commit by `@starci/seed/git` (the library the app's own git driver uses): `seed.json`, the
//      documents it names, and the place's sealed file `secrets.<dev|prod>.enc.yaml` opened IN MEMORY;
//   3. the declarations and the bundles go on the stdin of `seed-standard apply --env <env> [--dry]` inside the running jobs task
//      (`deploy.jobs.service`), over the harness's own ssh runner. That is the transport and the exposure the harness seed step already uses.
// The command's output is relayed as it prints it (names, ids, counts, typed codes; never a value). Nothing here prints, logs or writes a value.
//   node scripts/seed-standards-oneshot.mjs --env production --dry       what it would do (writes nothing)
//   node scripts/seed-standards-oneshot.mjs --env production --execute   applies (a standard with a receipt is skipped unless its pin is forced)
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const ROOT = process.cwd()
const require = createRequire(path.join(ROOT, "package.json"))
const YAML = require("yaml")
const HFS = path.dirname(require.resolve("@starci/hfs/package.json"))
const hfs = (file) => import(pathToFileURL(path.join(HFS, file)).href)

const OWNER_KEY = "WORKSPACE_OWNER_EMAIL"
const SEED_DOCUMENT = "seed.json"
const placeOf = (env) => (env === "production" || env === "prod" ? "prod" : "local")

/** The environment's identity as the harness CLI looks it up (its secret.env, then the harness home's); never printed. */
const identityOf = async () => {
    const home = process.env.STARCI_HARNESS_HOME ?? path.join(path.parse(ROOT).root, ".claude")
    const { hostAgeIdentity } = await import(pathToFileURL(path.join(home, "cli", "dist", "harness", "secret-env.js")).href)
    return hostAgeIdentity(ROOT)
}

/** The opened members of one standard's sealed file as `{opened, accounts}`; a file that cannot be opened is a typed reason, never a value. */
const sealedOf = (pinned, file, key) => {
    let bytes = null
    try {
        bytes = pinned.openSealed(file, { identity: { kind: "age-identity", env: { SOPS_AGE_KEY: key } } })
    } catch {
        return { opened: false, reason: "not_openable" }
    }
    if (bytes === null) return { opened: false, reason: "file_missing" }
    const doc = YAML.parse(bytes.toString("utf8")) ?? {}
    if (typeof doc.accounts !== "object" || doc.accounts === null) return { opened: false, reason: "not_a_mapping" }
    const accounts = Object.fromEntries(
        Object.entries(doc.accounts).map(([account, members]) => [account, Object.fromEntries(Object.entries(members ?? {}).map(([member, value]) => [member, typeof value === "string" ? value : ""]))]),
    )
    return { opened: true, accounts }
}

/** The stdin envelope of `seed-standard apply`: the declarations (owner resolved to an address) and one bundle per standard. */
export const buildEnvelope = async ({ env, ctx, key }) => {
    const { seedMemberFile } = await hfs("runtime/scripts/hfs/stack-seeds-config.mjs")
    const { envelopeOf } = await hfs("runtime/scripts/hfs/secret-document.mjs")
    const { pinRepository } = require("@starci/seed/git")
    const dir = path.join(ROOT, ".starcistacks", env, "seeds", "data", "seed-standards")
    const files = fs.readdirSync(dir).filter((file) => file.endsWith(".json")).sort()
    const documents = []
    const bundles = {}
    for (const file of files) {
        const declaration = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))
        const owner = declaration.owner
        if (owner !== undefined && typeof owner === "object" && typeof owner.secret === "string") {
            const member = path.join(ROOT, seedMemberFile(env, owner.secret))
            const values = ctx.sops.decrypt(member, envelopeOf(fs.readFileSync(member, "utf8")).format)
            declaration.owner = String(values[OWNER_KEY] ?? "")
        }
        documents.push({ path: `data/seed-standards/${file}`, document: declaration })
        const pinned = pinRepository({ repository: declaration.repository, commit: declaration.commit, cache: path.join(os.tmpdir(), "starci-seed-standards"), name: declaration.name })
        const seedText = pinned.readText(SEED_DOCUMENT)
        if (seedText === null) throw new Error(`${declaration.name}: no ${SEED_DOCUMENT} at ${declaration.commit}`)
        const texts = { [SEED_DOCUMENT]: seedText }
        for (const document of JSON.parse(seedText).documents ?? []) texts[document.path] = pinned.readText(document.path) ?? ""
        bundles[declaration.name] = { commit: pinned.commit, files: texts, sealed: sealedOf(pinned, `secrets.${placeOf(env) === "prod" ? "prod" : "dev"}.enc.yaml`, key) }
        console.log(`${declaration.name}: pinned at ${pinned.commit} (${Object.keys(texts).length} files, sealed file ${bundles[declaration.name].sealed.opened ? "opened" : `not opened: ${bundles[declaration.name].sealed.reason}`})`)
    }
    return `${JSON.stringify({ env, scope: env, entry: "seed-standards", kind: "data", documents, bundles })}\n`
}

const main = async () => {
    const args = process.argv.slice(2)
    const env = args[args.indexOf("--env") + 1]
    const execute = args.includes("--execute")
    if (args.indexOf("--env") === -1 || env === undefined || (!execute && !args.includes("--dry"))) {
        console.error("usage: node scripts/seed-standards-oneshot.mjs --env <env> --dry | --execute")
        process.exit(2)
    }
    const identity = await identityOf()
    const key = identity.read()
    if (key === undefined) throw new Error("no age identity of this machine (the harness's secret.env)")
    const { stackContext } = await hfs("stack/context.mjs")
    const { loadDeployConfig } = await hfs("stack/config.mjs")
    const { withRunner } = await hfs("stack/remote.mjs")
    const ctx = stackContext({ hostIdentity: identity })
    const input = await buildEnvelope({ env, ctx, key })
    const config = loadDeployConfig({ repoRoot: ROOT, env })
    const service = config.jobs?.service
    if (service === undefined) throw new Error(`${env} declares no deploy.jobs service`)
    const status = await withRunner(ctx, config, {}, {}, (run) => {
        const found = run(`docker ps -q --filter label=com.docker.swarm.service.name=${config.stack}_${service} --filter status=running`)
        const task = String(found.stdout ?? "").trim().split("\n")[0]
        if (!task) throw new Error(`no running task of ${config.stack}_${service}`)
        const result = run(`docker exec -i ${task} node be/dist/apps/cli/src/main.js seed-standard apply --env ${env}${execute ? "" : " --dry"}`, { input })
        process.stdout.write(String(result.stdout ?? ""))
        if (result.status !== 0) console.error(`seed-standard apply exited ${String(result.status)} (its error output is withheld: it may hold the opened values)`)
        return result.status
    })
    process.exit(status === 0 ? 0 : 1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((cause) => {
    console.error(`seed-standards-oneshot: ${String(cause?.message ?? cause).slice(0, 300)}`)
    process.exit(1)
})
