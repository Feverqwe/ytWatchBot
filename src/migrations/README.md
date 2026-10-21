# Database migrations

Migration sources live in this directory and are compiled to `dist/migrations`.
They run automatically during application startup and are recorded in the
`SequelizeMeta` table.

- Name migrations `YYYYMMDDHHmmss-description.ts` so ordering is deterministic.
- Export an `up` function typed with `Migration` from `../shared/migrator`.
- Add `down` only when rollback is safe for production data.
- Keep committed migrations immutable. Add a new migration for every schema change.
- Update the Sequelize model in `src/db/models.ts` in the same change as its migration.

The initial baseline is intentionally idempotent: it creates missing tables and indexes while
adopting databases previously initialized with `sequelize.sync()` without changing their data.

## Video delivery queue ordering

`20261021153000-index-video-delivery-queue` copies `videos.publishedAt` into existing delivery
queue rows, makes the column required, and adds `(chatId, publishedAt, videoId)` for ordered,
covering reads without joining `videos`. New entries must carry the video's publication date;
this is the ordering date, not the enqueue timestamp. Video publication dates are immutable in
the current insert-only discovery flow. Any future correction of those dates must update the
queue rows in the same transaction.

Stop the previous bot version before starting this release: old writers do not supply the new
required field. The migration runs before the checker and sender start and can resume after
partially completed MariaDB DDL. Rolling back to old code requires an explicit schema rollback
to allow inserts without `publishedAt`.

This queue change is specific to YouTube publication ordering. The sibling `twiMonBot` stream
and message queues have different delivery rules and do not need the same schema change.

