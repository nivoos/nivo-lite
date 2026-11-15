// The project check of the SEED STANDARDS (ext check `seed-standards`, owner R100-R106): every `<name>-seed-standard` the stack brings up is a
// COMPLETE workspace (one apply = a workspace that operates at once), judged by THIS project, never by the harness (which judges only the
// generic data standard: sealed, pinned, under the cap). It reads the stack's own declarations (`.starcistacks/<env>/seeds/seeds.yaml`
// entries whose command is `seed-standard apply`, their documents `nivo/seed-standard@1`): no repository name is written here.
//   1. the default load lists only seed standards: every document such an entry hands is a seed-standard declaration (its name ends
//      `-seed-standard`) carrying the completeness marker of this check; no seed manifest names a `-seed-backup` (a backup is brought back by
//      its explicit sync only);
//   2. per declaration, at its PINNED commit (read with `git show <commit>:<path>` from the repository when it is a local clone; a
//      repository this machine cannot read is a failure naming it): `seed.json` is a valid document of the ONE schema (`use: workspace`,
//      the back end's own reader), it holds no generated identity (no `id` member anywhere: every seeded thing is known by the seed's own key),
//      the layout (R107: data PLAIN; the only sealed files are `secrets.dev.enc.yaml` and `secrets.prod.enc.yaml`, each with the sops
//      metadata and every non-empty value `ENC[...]`, read by NAME, never decrypted), and READY: the back end's own `readinessOf` over the installation (plugins at their package versions, templates,
//      node steps, entrances), for the place(s) its target names.
// `node scripts/seed-standards.mjs --check` (the ext check), or `--repo <path> [--commit <rev>]` to judge one working repository before
// it is pinned. Reads the back end's source through ts-node (as scripts/seeds-graphs.mjs). Exit 1 on any failure or a standard NOT READY.
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const BE = path.resolve("be")
const require = createRequire(path.join(BE, "package-anchor.js"))
require("ts-node").register({ project: path.join(BE, "tsconfig.json"), transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node10" } })
require("tsconfig-paths").register({ baseUrl: BE, paths: { "@modules/*": ["./src/modules/*"], "@features/*": ["./src/features/*"] } })
const YAML = require("yaml")
const seedPolicy = require(path.join(BE, "src", "modules", "domain", "workspace-seed", "set-seed.policy.ts"))
const standardPolicy = require(path.join(BE, "src", "modules", "domain", "workspace-seed", "seed-standard.policy.ts"))
const readiness = require(path.join(BE, "src", "modules", "domain", "workspace-seed", "seed-readiness.policy.ts"))
const { INSTALLED, customerChannelProviders, inboundChannelsOf } = require(path.join(BE, "src", "modules", "domain", "installed-plugins", "index.ts"))

const failures = []
const fail = (line) => {
    failures.push(line)
    console.error(line)
}

/** The version of each installed plugin's package, read from the workspace package that ships it. */
const packageVersionOf = (packageName) => {
    if (packageName === null) return null
    for (const dir of fs.readdirSync("packages")) {
        const file = path.join("packages", dir, "package.json")
        if (!fs.existsSync(file)) continue
        const json = JSON.parse(fs.readFileSync(file, "utf8"))
        if (json.name === packageName || json.name?.endsWith(`/${packageName}`)) return json.version ?? null
    }
    return null
}
const installed = {
    plugins: INSTALLED.plugins.map((plugin) => ({ ...plugin, version: packageVersionOf(plugin.packageName) })),
    templatesOf: (module) => INSTALLED.templatesOf(module),
    inboundChannelsOf: (module) => {
        const agent = INSTALLED.templateAgentOf(module)
        const customer = customerChannelProviders()
        return agent === null ? new Set() : new Set([...inboundChannelsOf(agent)].filter((channel) => customer.has(channel)))
    },
}

const git = (repo, args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const showAt = (repo, commit, file) => {
    const result = git(repo, ["show", `${commit}:${file}`])
    return result.status === 0 ? result.stdout : null
}
const filesAt = (repo, commit) => git(repo, ["ls-tree", "-r", "--name-only", commit]).stdout.split("\n").filter(Boolean)

/** Every member `id` in a JSON value (a generated identity the seed must not carry). */
const idsIn = (value, at = "") =>
    Array.isArray(value)
        ? value.flatMap((item, index) => idsIn(item, `${at}[${index}]`))
        : value !== null && typeof value === "object"
          ? Object.entries(value).flatMap(([key, item]) => [...(key === "id" ? [`${at}.id`] : []), ...idsIn(item, `${at}.${key}`)])
          : []

/** The secret members of a sealed file by NAME (`set` / `empty`), and the values that are not sealed (by path, never the value). */
const sealedNamesOf = (text) => {
    const doc = YAML.parse(text) ?? {}
    const unsealed = []
    if (doc.sops === undefined || typeof doc.sops?.mac !== "string") unsealed.push("(no sops metadata)")
    const names = {}
    const walk = (value, at) => {
        if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) walk(item, [...at, key])
        else if (typeof value === "string" && value !== "" && !value.startsWith("ENC[")) unsealed.push(at.join("."))
        else if (typeof value !== "string") unsealed.push(at.join("."))
    }
    for (const [key, value] of Object.entries(doc)) if (key !== "sops") walk(value, [key])
    for (const [account, members] of Object.entries(doc.accounts ?? {})) {
        names[account] = Object.fromEntries(Object.entries(members ?? {}).map(([member, value]) => [member, value === "" ? "empty" : "set"]))
    }
    return { names, unsealed }
}

/**
 * Where this machine holds a clone of a declared standard: the declared repository when it is a local path, else `<SEED_STANDARD_CHECKOUTS>/
 * <name>` (a folder of clones named like the standards; the driver's cache when HARNESS-DATA publishes it). A remote is never fetched here.
 */
const localCloneOf = (ref) => {
    if (fs.existsSync(path.join(ref.repository, ".git"))) return ref.repository
    const root = process.env.SEED_STANDARD_CHECKOUTS
    return root === undefined ? ref.repository : path.join(root, ref.name)
}

/** Judges one standard at one commit of a local repository; answers nothing, records failures. */
const judge = (name, repo, commit) => {
    if (!fs.existsSync(path.join(repo, ".git"))) return fail(`${name}: no local clone of ${repo} on this machine (set SEED_STANDARD_CHECKOUTS to a folder of clones named like the standards)`)
    const resolved = git(repo, ["rev-parse", "--verify", `${commit}^{commit}`])
    if (resolved.status !== 0) return fail(`${name}: commit ${commit} not found in ${repo}`)
    const sha = resolved.stdout.trim()
    const text = showAt(repo, sha, "seed.json")
    if (text === null) return fail(`${name}: no seed.json at ${sha}`)
    let profile
    try {
        profile = seedPolicy.readSeedDocument(text, { name, commit: sha })
        seedPolicy.expandSetProfile(profile)
    } catch (error) {
        return fail(`${name}: seed.json is not a valid workspace seed (${error?.code ?? "?"} ${JSON.stringify(error?.params ?? {})})`)
    }
    const ids = idsIn(JSON.parse(text))
    if (ids.length > 0) fail(`${name}: generated identities in seed.json (a seeded thing is known by the seed's own key): ${ids.join(", ")}`)
    for (const document of profile.documents) if (showAt(repo, sha, document.path) === null) fail(`${name}: document ${document.path} missing at ${sha}`)
    const files = filesAt(repo, sha)
    const sealedFiles = new Map()
    const layout = files.map((file) => {
        const content = showAt(repo, sha, file) ?? ""
        const isSealed = /^sops:\s*$/mu.test(content)
        if (isSealed) sealedFiles.set(file, content)
        return { path: file, sealed: isSealed }
    })
    for (const problem of standardPolicy.layoutProblemsOf(layout)) fail(`${name}: ${problem}`)
    const namesOf = {}
    for (const [place, file] of Object.entries(standardPolicy.SEALED_FILES)) {
        if (!sealedFiles.has(file)) continue
        const sealed = sealedNamesOf(sealedFiles.get(file))
        if (sealed.unsealed.length > 0) fail(`${name}: ${file}: NOT SEALED at ${sealed.unsealed.join(", ")}`)
        namesOf[place] = sealed.names
    }
    const places = profile.target === "both" ? ["local", "prod"] : [profile.target]
    for (const place of places) {
        const missing = readiness.readinessOf(profile, installed, namesOf[place] ?? null, place)
        const line = readiness.readyLineOf(`${name} (${place}, ${sha.slice(0, 12)})`, missing)
        console.log(line)
        for (const note of readiness.sandboxTwinsOf(profile, namesOf[place] ?? null, place)) console.log(`${name} (${place}): ${note}`)
        if (missing.length > 0) failures.push(line)
    }
}

const at = (flag) => {
    const index = process.argv.indexOf(flag)
    return index === -1 ? null : process.argv[index + 1]
}
const repoArg = at("--repo")
if (repoArg !== null) {
    judge(path.basename(path.resolve(repoArg)), path.resolve(repoArg), at("--commit") ?? "HEAD")
} else {
    const manifests = fs.readdirSync(".starcistacks", { withFileTypes: true }).flatMap((entry) => {
        const file = entry.isDirectory() ? path.join(".starcistacks", entry.name, "seeds", "seeds.yaml") : null
        return file !== null && fs.existsSync(file) ? [file] : []
    })
    let declared = 0
    for (const manifest of manifests) {
        const text = fs.readFileSync(manifest, "utf8")
        if (/-seed-backup\b/u.test(text)) fail(`${manifest}: names a -seed-backup: a backup is never loaded by default (only its explicit sync brings it back)`)
        const doc = YAML.parse(text) ?? {}
        for (const entry of doc.entries ?? []) {
            if (!Array.isArray(entry.target) || !entry.target.includes("seed-standard")) continue
            const where = path.join(path.dirname(manifest), entry.path)
            const docs = fs.statSync(where).isDirectory() ? fs.readdirSync(where).filter((one) => one.endsWith(".json")).map((one) => path.join(where, one)) : [where]
            for (const file of docs) {
                let ref
                try {
                    ref = standardPolicy.readSeedStandardRef(JSON.parse(fs.readFileSync(file, "utf8")))
                } catch (error) {
                    fail(`${file}: not a seed-standard declaration (${JSON.stringify(error?.params ?? {})})`)
                    continue
                }
                declared += 1
                judge(ref.name, localCloneOf(ref), ref.commit)
            }
        }
    }
    if (declared === 0) console.log("seed standards: none declared by the stack")
}
if (failures.length > 0) {
    console.error(`seed standards: ${failures.length} failure(s)`)
    process.exitCode = 1
} else console.log("seed standards: complete")
