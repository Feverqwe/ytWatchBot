import loadConfig from "./tools/loadConfig";
import Locale from "./locale";
import Db from "./db";
import Youtube from "./services/youtube";
import Tracker from "./tracker";
import Sender from "./sender";
import Chat from "./chat";
import Checker, {ServiceInterface} from "./checker";
import YtPubSub from "./ytPubSub";
import Events from "events";
import path from "path";
import RateLimit2 from "./tools/rateLimit2";
import replaceBotRequest from "./tools/replaceBotRequest";
import {TUser} from "./router";

Object.assign(process.env, {
  NTBA_FIX_319: true,
  NTBA_FIX_350: true,
});

const TelegramBot = require('node-telegram-bot-api');

const debug = require('debug')('app:Main');

process.on('unhandledRejection', (err: Error & {code?: string}, promise) => {
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
  adminIds: [] as number[],
  channelBlackList: [] as string[],
};

loadConfig(path.join(__dirname, '..', 'config.json'), config);

class Main extends Events {
  config = config;
  locale: Locale;
  db: Db;
  youtube: Youtube;
  services: ServiceInterface[];
  serviceIdService: Map<string, ServiceInterface>;
  tracker: Tracker;
  sender: Sender;
  checker: Checker;
  bot: typeof TelegramBot;
  chat: Chat;
  botName!: string;
  ytPubSub: YtPubSub;

  constructor() {
    super();

    this.locale = new Locale();
    this.db = new Db(this);

    this.youtube = new Youtube(this);
    this.services = [this.youtube];
    this.serviceIdService = this.services.reduce((map, service) => {
      map.set(service.id, service);
      return map;
    }, new Map());

    this.tracker = new Tracker(this);
    this.sender = new Sender(this);
    this.checker = new Checker(this);
    this.ytPubSub = new YtPubSub(this);

    this.bot = this.initBot();
    this.chat = new Chat(this);
  }

  async init() {
    await this.db.init();
    await Promise.all([
      this.ytPubSub.init(),
      this.bot.getMe().then((user: TUser) => {
        if (!user.username) throw new Error('Bot name is empty');

        this.botName = user.username;
        return this.bot.startPolling();
      }),
    ]);
    this.checker.init();
    this.sender.init();
  }

  initBot() {
    replaceBotRequest(TelegramBot.prototype);

    const bot = new TelegramBot(this.config.token, {
      polling: {
        autoStart: false
      },
    });
    bot.on('polling_error', function (err: any) {
      debug('pollingError %s', err.message);
    });

    const limit = new RateLimit2(30);
    bot.sendMessage = limit.wrap(bot.sendMessage.bind(bot));
    bot.sendPhotoQuote = limit.wrap(bot.sendPhoto.bind(bot));

    const chatActionLimit = new RateLimit2(30);
    bot.sendChatAction = chatActionLimit.wrap(bot.sendChatAction.bind(bot));

    return bot;
  }

  getServiceById(id: string) {
    return this.serviceIdService.get(id);
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
