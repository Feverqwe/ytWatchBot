import loadConfig from "./tools/loadConfig";
import Locale from "./locale";
import Db from "./db";
import Channels from "./channels";
import Youtube from "./services/youtube";
import Users from "./users";
import MsgStack from "./msgStack";
import Daemon from "./daemon";
import Tracker from "./tracker";
import MsgSender from "./msgSender";
import Chat from "./chat";
import Checker from "./checker";
import PushApi from "./pushApi";
import Ratelimit from "./tools/ratelimit";

process.env.NTBA_FIX_319 = true;
const TelegramBot = require('node-telegram-bot-api');
const Events = require('events');
const path = require('path');
const tunnel = require('tunnel');

const debug = require('debug')('app:Main');

const config = {
  token: '',
  interval: 360,
  gaId: '',
  ytToken: '',
  checkOnRun: false,
  botName: 'ytWatchBot',
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
  }
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
    this.channels = new Channels(this);
    this.users = new Users(this);
    this.msgStack = new MsgStack(this);
    this.daemon = new Daemon(this);

    this.youtube = new Youtube(this);

    this.tracker = new Tracker(this);
    this.msgSender = new MsgSender(this);
    this.chat = new Chat(this);
    this.checker = new Checker(this);

    this.pushApi = new PushApi(this);

    this.bot = this.initBot();

    return this.db.init().then(() => {
      return this.bot.startPolling().then(() => {
        return this.pushApi.init();
      });
    }).then(() => {
      debug('running');
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
      debug('pollingError %o', err.message);
    });

    const limit = new Ratelimit(30);
    bot.sendMessage = limit.wrap(bot.sendMessage.bind(bot));
    bot.sendPhotoQuote = limit.wrap(bot.sendPhoto.bind(bot));

    return bot;
  }
}

const main = new Main();