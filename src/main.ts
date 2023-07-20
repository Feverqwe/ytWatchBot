import Db from "./db";
import Youtube from "./services/youtube";
import Sender from "./sender";
import Chat from "./chat";
import Checker, {ServiceInterface} from "./checker";
import YtPubSub from "./ytPubSub";
import Events from "events";
import RateLimit2 from "./tools/rateLimit2";
import replaceBotRequest from "./tools/replaceBotRequest";
import {TUser} from "./router";
import {appConfig} from "./appConfig";

Object.assign(process.env, {
  NTBA_FIX_319: true,
  NTBA_FIX_350: true,
});

const TelegramBot = require('node-telegram-bot-api');

const debug = require('debug')('app:Main');

process.on('unhandledRejection', (err: Error & {code?: string}, _promise) => {
  debug('unhandledRejection %o', err);
  if (err.code === 'EFATAL') {
    process.exit(1);
  }
});

class Main extends Events  {
  db: Db;
  youtube: Youtube;
  services: ServiceInterface[];
  serviceIdService: Map<string, ServiceInterface>;
  sender: Sender;
  checker: Checker;
  bot: typeof TelegramBot;
  chat: Chat;
  botName!: string;
  ytPubSub: YtPubSub;

  constructor() {
    super();

    this.db = new Db(this);

    this.youtube = new Youtube(this);
    this.services = [this.youtube];
    this.serviceIdService = this.services.reduce((map, service) => {
      map.set(service.id, service);
      return map;
    }, new Map());

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

    const bot = new TelegramBot(appConfig.token, {
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
