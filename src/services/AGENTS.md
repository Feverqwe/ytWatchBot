# Service adapter guide

`youtube.ts` implements the provider contract declared by `ServiceInterface` in `checker.ts`. Keep
provider-specific raw IDs inside this adapter; the checker wraps them before persistence.

## YouTube API behavior

- Validate external JSON with the existing Valibot response schemas before consuming it. If a
  requested field becomes optional, model and handle that absence explicitly.
- Route HTTP calls through the shared request wrapper and preserve request timeouts, retries, and
  YouTube error classification.
- Keep page traversal bounded by the API's `nextPageToken`; avoid accumulating duplicate video or
  channel IDs across pages.
- Account for quota through `costCounter` before API requests. Search endpoints are substantially
  more expensive than list endpoints, so prefer deterministic URL/ID extraction first.
- Preserve `filterFn` use: it lets the checker remove already-persisted videos before expensive
  detail requests.
- `getVideos` must continue to return `videos`, `videoIdChannelIds`, and `skippedChannelIds` with raw
  provider IDs. The checker relies on the video-to-requested-channel mapping for merged/channel
  activity entries.
- Apply `appConfig.channelBlackList` at the persisted-channel boundary, not by silently changing
  provider lookup results.

For tests, mock request responses at the shared HTTP boundary and cover pagination, malformed
payloads, quota/error handling, channel/video/user URL resolution, deduplication, and skipped
channels without using a live YouTube API key.
