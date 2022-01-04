import loadConfig from "./tools/loadConfig";
import Locale from "./locale";
import Db from "./db";
import Youtube from "./services/youtube";
import Tracker from "./tracker";
import Sender from "./sender";
import Chat from "./chat";
import Checker from "./checker";
import YtPubSub from "./ytPubSub";
import RateLimit from "./tools/rateLimit";
import Events from "events";
import path from "path";

process.env.NTBA_FIX_319 = true;
process.env.NTBA_FIX_350 = true;
const TelegramBot = require('node-telegram-bot-api');

const debug = require('debug')('app:Main');

process.on('unhandledRejection', (err, promise) => {
  debug('unhandledRejection %o', err);
  if (err.code === 'EFATAL') {
    process.exit(1);
  }
});

const config = {
  token: '',
  gaId: '',
  ytToken: '',
  emitCheckChannelsEveryMinutes: 5,
  checkChannelIfLastSyncLessThenHours: 4,
  fullCheckChannelActivityForDays: 7,
  doFullCheckChannelActivityEveryHours: 4,
  channelSyncTimeoutMinutes: 5,
  emitSendMessagesEveryMinutes: 5,
  emitCheckExistsChatsEveryHours: 24,
  chatSendTimeoutAfterErrorMinutes: 1,
  emitCleanChatsAndVideosEveryHours: 1,
  cleanVideosIfPublishedOlderThanDays: 14,
  emitUpdateChannelPubSubSubscribeEveryMinutes: 5,
  updateChannelPubSubSubscribeIfExpiresLessThenMinutes: 10,
  channelPubSubSubscribeTimeoutMinutes: 5,
  emitCleanPubSubFeedEveryHours: 1,
  cleanPubSubFeedIfPushOlderThanDays: 14,
  defaultChannelName: 'NationalGeographic',
  push: {
    host: 'localhost',
    port: 80,
    path: '/',
    secret: '',
    callbackUrl: '',
    leaseSeconds: 86400
  },
  db: {
    host: 'localhost',
    port: 3306,
    database: 'ytWatchBot',
    user: '',
    password: ''
  },
  adminIds: [],
};

loadConfig(path.join(__dirname, '..', 'config.json'), config);

class Main extends Events {
  async init() {
    this.config = config;
    this.locale = new Locale();
    this.db = new Db(this);

    if (process.argv.includes('--migrate')) {
      return this.db.migrate();
    }

    this.youtube = new Youtube(this);
    this.services = [this.youtube];

    this.tracker = new Tracker(this);
    this.sender = new Sender(this);
    this.checker = new Checker(this);

    this.ytPubSub = new YtPubSub(this);

    this.bot = this.initBot();
    this.chat = new Chat(this);

    await this.db.init();
    await Promise.all([
      this.ytPubSub.init(),
      this.bot.getMe().then((user) => {
        this.botName = user.username;
        return this.bot.startPolling();
      }),
    ]);
    this.checker.init();
    this.sender.init();
  }

  initBot() {
    const bot = new TelegramBot(this.config.token, {
      polling: {
        autoStart: false
      },
    });
    bot.on('polling_error', function (err) {
      debug('pollingError %s', err.message);
    });

    const limit = new RateLimit(30);
    bot.sendMessage = limit.wrap(bot.sendMessage.bind(bot));
    bot.sendPhotoQuote = limit.wrap(bot.sendPhoto.bind(bot));

    return bot;
  }
}

const main = new Main();
main.init().then(() => {
  debug('ready');
}, (err) => {
  debug('init error', err);
  process.exit(1);
});

export default Main;
