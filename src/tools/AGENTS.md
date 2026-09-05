# Project-specific tools guide

This directory contains helpers whose implementations are specific to `ytWatchBot`. Generic
helpers shared with `twiMonBot` live in `src/shared/tools/` and follow
`src/shared/AGENTS.md`. Move a helper into `shared` when the two implementations can be identical.

## Expectations

- Keep helpers narrowly scoped and preserve generic input/output types.
- Preserve rejection behavior. Callers depend on errors propagating through retry, fallback, and
  cleanup branches; do not silently convert failures to `undefined` unless that is the helper's
  documented behavior.
- `serviceId` is a persistence format. Any encoding change needs backward compatibility for IDs
  already stored in MariaDB.
- Shared concurrency, scheduling, Telegram HTML, and API helpers must be changed in both sibling
  repositories and verified with `npm run shared:check`.

## External-boundary helpers

- `shared/tools/fetchRequest.ts` is the common Axios-based compatibility wrapper. Preserve normalized lowercase
  headers, response body modes, timeouts, keep-alive behavior, and the exported error classes when
  changing it.
- `src/shared/tools/telegramBotApi.ts` is shared sibling infrastructure. Never expose the bot token
  in errors or debug logs.
- `shared/expressPubSub.ts` handles public callback traffic. Preserve raw-body access for HMAC validation,
  reject absent/invalid signatures, validate the hub callback/topic, and acknowledge requests with
  the protocol-compatible status/body.
- `src/shared/tools/passTgEx.ts` and the sender classify `TelegramApiError` instances by structured
  error code and description. Add narrowly matched patterns and keep unknown errors
  retryable/visible.

Add focused Jest tests for utility behavior when changing parsing, caching, locking, scheduling,
escaping, request normalization, or error classification. Use fake timers for time-based helpers
and local mocks for network boundaries.
