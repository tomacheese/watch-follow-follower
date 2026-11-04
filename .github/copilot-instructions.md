# GitHub Copilot code review instructions

Project overview, commands, architecture, and conventions are in [`AGENTS.md`](../AGENTS.md). Write review comments in English.

## Review focus

- Secrets: no API keys, passwords, tokens, Discord webhook URLs, or cookies in code, logs, or diffs.
- Error handling: no swallowed exceptions from unofficial APIs, network, or auth; fatal errors go through `logger.error(...)` in the top-level catch in `src/main.ts`; avoid `warn` or above for expected, retried conditions (forwarded to GlitchTip).
- Configuration: no hard-coded paths or settings; follow `src/infra/config.ts`. New settings must update `config.sample.json`, the config types, and `README.md`.
- Types: flag `any` and suppressed type errors.
- HTTP: X/Twitter traffic must use the wrapped clients, not direct `fetch`.

## Known patterns, do not flag

- No automated tests exist; do not flag their absence.
- `data/` is intentionally git-ignored.
- Japanese text in `src/presentation/discord.ts` is intentional user-facing notification text.
- Formatting is enforced by Prettier and ESLint.
