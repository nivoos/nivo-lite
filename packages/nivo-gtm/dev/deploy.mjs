// Deploys the NIVO Tăng trưởng package to the dev instance through the author CLI, as any business repository does:
//
//   NIVOOS_API_KEY=<owner key> node dev/deploy.mjs [--url https://nivo-app-dev.starci.org]
//   (or store the key once: `npx nivoos auth set --env dev < key-file`)
//
// The provider templates are deployed once per instance by the platform, so this script deploys only the package. Secrets are DEV TEST VALUES: read from the harness custody
// (`starci app secret get --env dev nivo-gtm <NAME> --to-file`, the keys `nivo-gtm/*`) when they exist, else made up for this run (random, never real, never printed). The real bot, bank
// account and Google sign-in are connected by the owner in the console afterwards. The secrets file is written next to the package, git-ignored, and deleted at the end. Safe to run twice.
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(HERE, "..")
const STARCI = process.env.STARCI_CLI ?? "D:/.claude/cli/dist/main.js"
const argValue = (name, fallback) => {
    const at = process.argv.indexOf(name)
    return at >= 0 ? process.argv[at + 1] : fallback
}
const URL_DEV = argValue("--url", "https://nivo-app-dev.starci.org")
const SECRET_NAMES = [
    "TELEGRAM_TEAM_BOT_TOKEN",
    "TELEGRAM_TEAM_WEBHOOK_SECRET",
    "SEPAY_NIVO_API_TOKEN",
    "SEPAY_NIVO_WEBHOOK_SECRET",
]
/** Public facts of the accounts (dev test values until the owner connects the real ones). */
const PUBLIC_FIELDS = { TELEGRAM_TEAM_BOT_USERNAME: "nivo_gtm_dev_bot", SEPAY_NIVO_ACCOUNT_NUMBER: "0000000000" }

const say = (line) => process.stdout.write(`${line}\n`)
const fail = (line) => {
    process.stderr.write(`${line}\n`)
    process.exit(1)
}

/** A dev custody value when the harness has one; null otherwise. */
const custody = (name) => {
    const ran = spawnSync("node", [STARCI, "app", "secret", "get", "--env", "dev", "nivo-gtm", name, "--to-file"], {
        encoding: "utf8",
    })
    const line = `${ran.stdout ?? ""}\n${ran.stderr ?? ""}`
        .split(/\r?\n/u)
        .find((each) => each.startsWith(`${name}_FILE=`))
    if (ran.status !== 0 || line === undefined) return null
    const value = readFileSync(line.slice(name.length + 6), "utf8").trim()
    return value === "" ? null : value
}
const made = (name) => `dev-${name.toLowerCase().replace(/_/gu, "-")}-${randomBytes(12).toString("hex")}`

const secretsFile = resolve(PACKAGE_DIR, "dev.secrets.env")
const lines = ["# env: dev", ...SECRET_NAMES.map((name) => `${name}=${custody(name) ?? made(name)}`)]
writeFileSync(secretsFile, `${lines.join("\n")}\n`)
try {
    const ran = spawnSync(
        "node",
        [
            resolve(PACKAGE_DIR, "node_modules/@starci/nivoos-cli/dist/main.js"),
            "package",
            "deploy",
            "src/nivo-gtm.package.ts",
            "--env",
            "dev",
            "--secrets",
            secretsFile,
            "--url",
            URL_DEV,
            "--public-json",
            JSON.stringify(PUBLIC_FIELDS),
        ],
        { cwd: PACKAGE_DIR, encoding: "utf8", env: process.env },
    )
    say(`${ran.stdout ?? ""}${ran.stderr ?? ""}`.trim())
    if (ran.status !== 0) fail("deploy of nivo-gtm failed")
} finally {
    rmSync(secretsFile, { force: true })
}
say("deployed nivo-gtm; the NIVO Tăng trưởng workspace is in the owner's switcher")
