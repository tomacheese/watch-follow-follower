# AGENTS.md

## Language

- All deliverables are written in English: commit messages, PR/Issue titles and bodies, review comments, code comments and JSDoc, and documentation (including this file and `README.md`).
- Exceptions: the Japanese user-facing Discord notification text in `src/presentation/discord.ts`, quotations, technical identifiers, generated files, and external source text.
- Log and error messages are in English.
- Conversation with the user may be in any language the user prefers; this does not affect deliverables.

## Overview

Monitors the followers and following of an X (Twitter) account, diffs them against the previous run, and posts changes to a Discord webhook. It relies on unofficial APIs, so it can break when X changes. TypeScript on Node.js (ESM), run with `tsx`; there is no build step.

## Commands

Use `pnpm` (enforced by `preinstall`). Node.js version: see `.node-version`.

```bash
pnpm install        # install dependencies
pnpm dev            # run with tsx watch
pnpm start          # run once (src/main.ts)
pnpm lint           # prettier --check, eslint, and tsc (type check)
pnpm lint:tsc       # type check only
pnpm fix            # prettier --write and eslint --fix
```

There are no automated tests. The minimum quality bar is `pnpm lint` passing (it includes the `tsc` type check).

## Architecture

- `src/main.ts`: entry point and overall flow (auth, fetch, diff, notify, save). Top-level catch logs fatal errors; transient X login errors (366/131) are logged at `info` so they are not sent to GlitchTip.
- `src/app/fetch-users.ts`: cursor-based pagination to fetch the full follower/following list.
- `src/core/`: `diff.ts` (added/removed diff), `normalize.ts` (API response to `UserSnapshot`, sorting), `retry.ts` (exponential backoff, 429 handling), `types.ts` (snapshot/diff file types).
- `src/infra/`: `auth.ts` (login and cookie cache), `cycletls.ts` (CycleTLS-backed `fetch` for TLS fingerprinting, proxy support), `config.ts` (config file and environment variables), `fs.ts` (JSON file I/O), `remote-config-fetch.ts` (validated, cached fetch of the remote configs used by `twitter-openapi-typescript`).
- `src/presentation/discord.ts`: Discord webhook notification.
- `Dockerfile` / `entrypoint.sh`: the container runs `pnpm start` every 30 minutes. `docker.yml` and `nodejs-ci-pnpm.yml` delegate to reusable workflows in `book000/templates`.

## Conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/); branches follow [Conventional Branch](https://conventional-branch.github.io) (`feat/`, `fix/`, ...).
- TypeScript is `strict`, including `noUnusedLocals` / `noUnusedParameters`. Do not use `any` or suppress type errors; type things properly.
- Write JSDoc for functions and classes where it adds information beyond the name and signature.
- Logging: do not use `console.*`. Create a logger per file with `Logger.configure('<category>')` from `@book000/node-utils`. Fatal errors go through `logger.error(...)` in the top-level catch in `src/main.ts`; when `SENTRY_DSN` is set, error/warn logs are forwarded to GlitchTip, so avoid `warn` or above for expected, retried conditions.
- HTTP: do not call `fetch` directly for X/Twitter traffic. Use the wrapped clients (`twitter-openapi-typescript`, `@the-convocation/twitter-scraper`, `cycletls`). The Discord webhook is the only direct `fetch`.
- Configuration: follow the pattern in `src/infra/config.ts` (environment variables and `config.json`). Paths and output locations are overridable by `CONFIG_PATH` (default `./data/config.json`), `OUTPUT_DIR` (default `./data`), and `COOKIE_CACHE_PATH` (default `./data/twitter-cookies.json`); never hard-code new settings. When adding a setting, update `config.sample.json`, the types in `src/infra/config.ts`, and `README.md`.
- Output: snapshots and diffs are written to `<OUTPUT_DIR>/<targetUsername>/{followers.json,following.json,diff.json}`. Snapshots are updated only after notification succeeds so that a failed notification is re-detected on the next run. `data/` is git-ignored.

## Security

- Never commit API keys, passwords, tokens, Discord webhook URLs, or cookies. Credentials live in `data/config.json` or environment variables.
- Do not write credentials, cookies, or personal data to logs. Error messages forwarded to GlitchTip are truncated (2000 characters) because third-party errors can embed full HTTP headers and bodies.
- Treat the cookie cache (`data/twitter-cookies.json`) as a secret.

## Review notes

- Absence of automated tests is known and not a finding by itself.
- Non-English text in `src/presentation/discord.ts` is intentional (user-facing notification text).
