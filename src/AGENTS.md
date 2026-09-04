# Source architecture guide

These instructions apply to application code under `src/`. Follow the repository-level
`AGENTS.md` as well.

## Runtime composition

`Main` is the dependency hub. Initialization order is significant:

1. Authenticate to MariaDB and synchronize Sequelize models.
2. Start the Express/WebSub server and Telegram polling.
3. Start the checker and sender background loops.

`main.ts` constructs and starts the application at module load. Avoid importing it for runtime
helpers or tests when a type-only import or a smaller dependency can be used.

The primary data flow is:

1. `Chat` registers ordered middleware and command handlers on `Router`.
2. Subscriptions connect chats and wrapped service channel IDs in `Db`.
3. `Checker` leases due channels, requests videos, and transactionally records videos plus
   chat/video delivery rows.
4. `Sender` runs up to ten per-chat workers; `ChatSender` sends one queued video at a time and then
   deletes the queue row.
5. WebSub pushes mark channels as changed so the checker can prioritize them; polling remains the
   authoritative video-fetch path.

## Domain invariants

- Persisted external IDs use `serviceId.wrap`; unwrap only at the service boundary. A wrapped ID
  contains a two-character service prefix plus a JSON-encoded raw ID. Do not construct or slice it
  ad hoc outside the helper.
- `ChatIdChannelIdModel` represents subscriptions. `ChatIdVideoIdModel` is a durable delivery
  queue, not merely history.
- Telegram channel forwarding is represented by a child `ChatModel` and `parentChatId`; preserve
  both the source chat and destination-channel behavior.
- Short-video filtering, mute state, preview visibility, chat migration, and blocked-chat cleanup
  affect delivery semantics. Exercise these branches when changing queue or sender code.
- Channel sync and WebSub subscription timeout fields are leases. Set the lease before external
  work so another loop cannot select the same rows.
- Multi-model writes in `Db` that form one state transition must remain transactional. Preserve the
  existing deadlock retry around video insertion.
- The English locale object defines the compile-time key set for `Locale`; add a locale key before
  using it in a route.

## Editing by area

- For a Telegram command, register middleware in the intended order in `Chat`, support both text
  and callback queries where appropriate, and keep callback data within Telegram limits.
- For routing changes, remember that each extracted bot command gets its own `RouterReq`/`RouterRes`
  dispatch and that calling `next()` controls ordered fall-through.
- For a database change, add a new migration and update the model declaration, `Model.init`,
  associations/indexes, creation types, and every bulk/upsert update list that should persist the
  field. Never edit a migration that may already be applied.
- For checker changes, distinguish raw provider IDs from wrapped persisted IDs and preserve the
  full-sync window, publication cutoff, skipped-channel handling, and merged-video IDs.
- For sender changes, delete queue rows only after success or an explicitly skippable Telegram
  error. Blocking errors remove the chat; transient errors leave work retryable and apply a send
  timeout.
- For WebSub changes, preserve challenge handling and signature verification in
  `tools/expressPubSub.ts`; do not trust or parse an unauthenticated POST body.

## Verification

Prefer deterministic unit tests around pure parsing, routing, formatting, and error classification.
Mock the `Main` collaborators for orchestration tests. Never start real polling merely by importing
`main.ts`, and never require live Telegram, YouTube, WebSub, or MariaDB access in the default test
run.
