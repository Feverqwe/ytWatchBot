# Repository guide

## Project overview

`ytWatchBot` is a long-running Node.js 24/TypeScript Telegram bot. It watches YouTube channels,
stores subscriptions and pending notifications in MariaDB, receives YouTube WebSub pushes, and
sends new-video notifications through Telegram.

The process has several cooperating loops rather than a request/response-only lifecycle. Keep
database state transitions, retry behavior, and concurrency limits intact when changing a flow.

## Repository map

- `src/main.ts` wires the application together and starts it as a module side effect.
- `src/chat.ts` and `src/router.ts` implement Telegram commands and callback-query routing.
- `src/checker.ts` discovers videos and creates per-chat delivery queue entries.
- `src/sender.ts` and `src/chatSender.ts` drain that queue and handle Telegram failures.
- `src/db.ts` contains Sequelize models, associations, schema initialization, and all persistence
  operations. There is no migrations directory.
- `src/ytPubSub.ts` and `src/webServer.ts` manage the WebSub callback and subscription renewal.
- `src/services/youtube.ts` is the YouTube Data API adapter.
- `src/tools/` contains shared concurrency, HTTP, Telegram, formatting, and scheduling helpers.
- `src/locale/en.ts` is the user-facing message dictionary.
- `packages/noop/` replaces unused transitive Cypress request packages during installation.

More specific instructions live in `src/AGENTS.md`, `src/tools/AGENTS.md`, and
`src/services/AGENTS.md`.

## Setup and commands

- Use Node.js 24 (`.nvmrc`).
- Install exact dependencies with `npm ci`.
- Use `example.env` as the list of supported environment variables. Never commit real tokens,
  chat IDs, callback secrets, or database credentials.
- `npm run typescript:check` performs the fastest repository-wide correctness check.
- `npm run prettier` checks formatting; `npm run prettier:fix` rewrites `src`.
- `npm run build` deletes `dist` and compiles the project.
- Jest is configured through `jest.config.js`, but the repository currently has no committed test
  suite and no `test` script. If tests are added, run them explicitly with `npx jest` and add a
  package script only when it is useful to all contributors.

For ordinary TypeScript changes, run `npm run typescript:check` and `npm run prettier`. Run a full
build when changing configuration, startup, imports, or emitted runtime behavior. Integration
testing needs disposable Telegram/YouTube credentials and MariaDB; do not point automated checks
at the production bot or database.

## Code conventions

- Follow `.prettierrc.json`: single quotes, no bracket spacing, trailing commas, 100-column width.
- Preserve the existing style of extensionless relative imports and default exports for the main
  class/function in a file.
- Prefer small focused changes over opportunistic rewrites of the large legacy modules.
- Use `getDebug('app:...')` for diagnostic output and `LogFile` only for the existing durable
  operational audit streams. Do not log secrets or full Telegram/YouTube credentials.
- Keep user-visible text in the locale dictionary and access it through `Locale.m`; keep all locale
  dictionaries key-compatible.
- Treat dates stored by Sequelize as `Date` values and preserve the code's explicit seconds,
  minutes, hours, and days conversions.
- Do not edit generated `dist/`, installed `node_modules/`, runtime `log/`, or local `.env` files.

## Change checklist

- Trace a change end to end: Telegram route -> DB subscription -> checker queue -> sender, or
  WebSub callback -> channel dirty state -> checker.
- Preserve idempotency. Scheduled jobs and WebSub deliveries can repeat, and overlapping work is
  intentionally guarded by `promiseLimit`, `getInProgress`, throttles, unique keys, and
  transactions.
- Consider cleanup and retry paths whenever adding persistent state.
- Update `example.env` and `appConfig.ts` together for configuration changes.
- Update this guide when commands, layout, runtime requirements, or architectural boundaries
  change.
