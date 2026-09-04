# Shared tools guide

This directory contains low-level helpers used across multiple background flows. Changes here have
a wider blast radius than their size suggests.

## Expectations

- Keep helpers narrowly scoped and preserve generic input/output types.
- Preserve rejection behavior. Callers depend on errors propagating through retry, fallback, and
  cleanup branches; do not silently convert failures to `undefined` unless that is the helper's
  documented behavior.
- For concurrency helpers, release locks/cache entries in `finally` and handle both resolved and
  rejected promises. `getInProgress` intentionally skips overlapping calls, while `promiseLimit`
  queues them; they are not interchangeable.
- Scheduling helpers return cancellation functions and align their first run to the configured
  time boundary. A replacement scheduler must retain alignment and cancellation semantics.
- `serviceId` is a persistence format. Any encoding change needs backward compatibility for IDs
  already stored in MariaDB.
- Telegram HTML must go through `htmlSanitize`/`escapeTextForBrowser`. Keep Telegram's 4096-character
  message limit in `splitTextByPages`.

## External-boundary helpers

- `fetchRequest.ts` is the common Axios-based compatibility wrapper. Preserve normalized lowercase
  headers, response body modes, timeouts, keep-alive behavior, and the exported error classes when
  changing it.
- `telegramBotApi.ts` exposes migrated v2 `Api` methods through a rate-limited facade. Node streams
  must be converted to `InputFile` at the upload boundary, and update handlers receive the v2
  `Context`. Never expose the bot token in errors or debug logs.
- `expressPubSub.ts` handles public callback traffic. Preserve raw-body access for HMAC validation,
  reject absent/invalid signatures, validate the hub callback/topic, and acknowledge requests with
  the protocol-compatible status/body.
- `passTgEx.ts` and the sender classify Telegram errors by both code and message. Add narrowly
  matched patterns and keep unknown errors retryable/visible.

Add focused Jest tests for utility behavior when changing parsing, caching, locking, scheduling,
escaping, request normalization, or error classification. Use fake timers for time-based helpers
and local mocks for network boundaries.
