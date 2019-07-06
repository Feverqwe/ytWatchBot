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

process.env.NTBA_FIX_319 = true;
process.env.NTBA_FIX_350 = true;
const TelegramBot = require('node-telegram-bot-api');
const Events = require('events');
const path = require('path');
const tunnel = require('tunnel');

const debug = require('debug')('app:Main');

const config = {
  token: '',
  gaId: '',
  ytToken: '',
  emitCheckChannelsEveryMinutes: 5,
  checkChannelIfLastSyncLessThenHours: 4,
  fullCheckChannelActivityForDays: 7,
  doFullCheckChannelActivityEveryHours: 4,
  chatSendTimeoutMinutes: 1,
  channelSyncTimeoutMinutes: 5,
  emitCleanChatsAndVideosEveryHours: 1,
  cleanVideosIfPublishedOlderThanDays: 14,
  emitSendMessagesEveryMinutes: 5,
  emitUpdateChannelPubSubSubscribeEveryMinutes: 5,
  updateChannelPubSubSubscribeIfExpiresLessThenMinutes: 10,
  channelPubSubSubscribeTimeoutMinutes: 5,
  emitCleanPubSubFeedEveryHours: 1,
  cleanPubSubFeedIfPushOlderThanDays: 14,
  push: {
    port: 80,
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
  proxy: null,
};

loadConfig(path.join(__dirname, '..', 'config.json'), config);

class Main extends Events {
  constructor() {
    super();

    this.init();
  }

  init() {
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

    return this.db.init().then(() => {
      return Promise.all([
        this.ytPubSub.init(),
        this.checker.init(),
        this.sender.init(),
        this.bot.getMe().then((user) => {
          this.botName = user.username;
          return this.bot.startPolling();
        }),
      ]);
    }).then(() => {
      debug('ready');
    }, (err) => {
      debug('init error', err);
      process.exit(1);
    });
  }

  initBot() {
    let request = null;
    if (this.config.proxy) {
      request = {
        agent: tunnel.httpsOverHttp({
          proxy: this.config.proxy
        })
      };
    }

    const bot = new TelegramBot(this.config.token, {
      polling: {
        autoStart: false
      },
      request: request
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