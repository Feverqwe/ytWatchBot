import 'dotenv/config';

const {
  TELEGRAM_TOKEN = '',
  GA_TID = '',
  YOUTUBE_TOKEN = '',
  YOUTUBE_PUBSUB_HOST = '',
  YOUTUBE_PUBSUB_PORT = '',
  YOUTUBE_PUBSUB_PATH = '',
  YOUTUBE_PUBSUB_SECRET = '',
  YOUTUBE_PUBSUB_CALLBACK_URL = '',
  DB_HOST = '',
  DB_PORT = '',
  DB_DATABASE = '',
  DB_USER = '',
  DB_PASSWORD = '',
  TG_ADMIN_CHAT_ID = '',
  CHANNEL_BLACKLIST = '',
} = process.env;

export const appConfig = {
  token: TELEGRAM_TOKEN,
  gaId: GA_TID,
  ytToken: YOUTUBE_TOKEN,
  emitCheckChannelsEveryMinutes: 5,
  checkChannelIfLastSyncLessThenHours: 4,
  fullCheckChannelActivityForDays: 7,
  doFullCheckChannelActivityEveryHours: 4,
  chatSendTimeoutAfterErrorMinutes: 1,
  channelSyncTimeoutMinutes: 5,
  emitCleanChatsAndVideosEveryHours: 1,
  cleanVideosIfPublishedOlderThanDays: 14,
  emitSendMessagesEveryMinutes: 5,
  emitCheckExistsChatsEveryHours: 24,
  emitUpdateChannelPubSubSubscribeEveryMinutes: 5,
  updateChannelPubSubSubscribeIfExpiresLessThenMinutes: 10,
  channelPubSubSubscribeTimeoutMinutes: 5,
  emitCleanPubSubFeedEveryHours: 1,
  cleanPubSubFeedIfPushOlderThanDays: 14,
  defaultChannelName: 'NationalGeographic',
  push: {
    host: YOUTUBE_PUBSUB_HOST,
    port: Number(YOUTUBE_PUBSUB_PORT),
    path: YOUTUBE_PUBSUB_PATH,
    secret: YOUTUBE_PUBSUB_SECRET,
    callbackUrl: YOUTUBE_PUBSUB_CALLBACK_URL,
    leaseSeconds: 86400,
  },
  db: {
    host: DB_HOST,
    port: Number(DB_PORT),
    database: DB_DATABASE,
    user: DB_USER,
    password: DB_PASSWORD,
  },
  adminIds: TG_ADMIN_CHAT_ID.split(',')
    .map((v) => Number(v.trim()))
    .filter(Boolean),
  channelBlackList: CHANNEL_BLACKLIST.split(',')
    .map((v) => v.trim())
    .filter(Boolean),
};
