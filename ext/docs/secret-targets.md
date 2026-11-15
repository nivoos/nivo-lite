# Secret targets of the two package seed standards (READY PATCH, not yet in `ext/manifest.json`)

Owner 2026-11-15: "set env with `-ext` per package". The two package seed standards each keep their credentials in the only sealed
files of their repository (`secrets.dev.enc.yaml`, `secrets.prod.enc.yaml`, [seeds-and-data](../../.starciwork/concepts/seeds-and-data.md)
rules 9-12). The harness command `starci app secret set --env <env> --ext <target> <KEY>...` seals into such a file once the project's
ext declares the target. The harness holds nothing of what the file means; this folder does.

## Why the declaration is not in the manifest yet

The lane runs `@starci/hfs` 6.13.0 and `starci` 1.1.0-alpha.120, which refuse an unknown manifest key (`HFS_EXT_INVALID`: "an extension holds
only schema, api, rules, checks, packages"). The branch `pkg/claude-secret-ext` of the harness adds `secretTargets`, the command option and the
rule R429. Folding the block below in before that CLI is installed makes `starci app check` red, so (as with `PACKAGES-TO-FOLD.md`) the
block waits here.

The day the restart owner installs it (`publish-local` of the harness packages, then `install-local` in the lane, so the lane's `@starci/hfs`
and CLI are the versions that carry `secretTargets`): add the block below as the manifest's top-level key `secretTargets` (beside `packages`),
run `starci app check` (R381 judges the shape, R429 the files: a missing, an unsealed or a plain-valued file), then the commands below work.

## The block

```json
"secretTargets": [
  {
    "id": "blocks-core",
    "why": "Credentials of the blocks-core seed standard (the demo flower shop): accounts.<account>/<member>, sealed per environment (seeds-and-data rules 9-12).",
    "root": "../../Repositories/blocks-core-seed-standard",
    "environments": { "dev": "secrets.dev.enc.yaml", "production": "secrets.prod.enc.yaml" },
    "recipients": ".sops.yaml",
    "under": ["accounts"],
    "depth": 2
  },
  {
    "id": "nivo-web-core",
    "why": "Credentials of the nivo-web-core seed standard (NIVO Web): accounts.<account>/<member>, sealed per environment (seeds-and-data rules 9-12).",
    "root": "../../Repositories/nivo-web-core-seed-standard",
    "environments": { "dev": "secrets.dev.enc.yaml", "production": "secrets.prod.enc.yaml" },
    "recipients": ".sops.yaml",
    "under": ["accounts"],
    "depth": 2
  }
]
```

`root` is the sibling checkout of the standard (from the lane `D:/starci-lanes/<lane>` that is `D:/Repositories/<name>-seed-standard`; a CI
runner has none, and R429 then judges nothing). The `recipients` file is the standard's own `.sops.yaml`: its creation rule per file names who
the file is sealed to (dev = the owner's key; production = the owner's key plus the server's key), so the command never lists a recipient.
A key is `<account>/<member>` (depth 2 below `accounts`); the member names are the closed list of rule 11 (`credential`, `webhookSecret`,
`apiToken`, `fact.<name>`), judged by the check `seed-standards`, not by the harness. The environment is the file, never part of a key name.

## The owner's command lines

Every command prompts for the value masked (or reads redirected stdin); nothing prints a value. Each standard's own git hook then refuses an
unsealed file; commit and push each standard by hand afterwards (the command writes only the file).

```
starci app secret set  --env dev        --ext blocks-core    telegram-main/credential telegram-main/webhookSecret
starci app secret set  --env production --ext blocks-core    telegram-main/credential
starci app secret set  --env dev        --ext nivo-web-core  zalo-main/credential
starci app secret set  --env production --ext nivo-web-core  sepay-main/credential sepay-main/webhookSecret
starci app secret list --env dev        --ext nivo-web-core                       # key names only
starci app secret unset --env dev       --ext nivo-web-core  crm-main/credential --execute   # a dry run without --execute
```

`--ext` replaces the provider slug of the member form (`set --env <env> <slug> <KEY>`): the two together are refused (a bare slug is not a key
of depth 2). `get` is refused with `--ext`. An unknown target is refused with the list of declared ones.

*State: built and proved against real sops and a throwaway age key in the harness (R4-NOTES SECRET-EXT); not run on the real standards; the
manifest block is not folded in until the install above.*
