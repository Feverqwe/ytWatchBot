import Db from './db';
import Youtube from './services/youtube';
import Sender from './sender';
import Chat from './chat';
import Checker, {ServiceInterface} from './checker';
import Events from 'events';
import {appConfig} from './appConfig';
import {getTelegramBot} from './shared/tools/telegramBotApi';
import type {Bot} from 'node-telegram-bot-api';
import {getDebug} from './shared/tools/getDebug';
import WebServer from './shared/webServer';
import YtPubSub from './ytPubSub';
import AppLogs from './shared/appLogs';
import requireDatabaseReady from './shared/requireDatabaseReady';

const debug = getDebug('app:Main');

class Main extends Events {
  readonly logs = new AppLogs();
  db: Db;
  youtube: Youtube;
  services: ServiceInterface[];
  serviceIdService: Map<string, ServiceInterface>;
  sender: Sender;
  checker: Checker;
  bot: Bot;
  chat: Chat;
  webServer: WebServer;
  ytPubSub: YtPubSub;
  private runtimeStarted = false;
  private stopPromise?: Promise<void>;

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
    this.webServer = new WebServer(appConfig.webServer);
    this.ytPubSub = new YtPubSub(this);

    this.bot = getTelegramBot(appConfig.token, appConfig.telegramProxyUrl);
    this.chat = new Chat(this);
  }

  async init() {
    this.webServer.app.use(requireDatabaseReady(() => this.isReady));
    this.ytPubSub.bind(this.webServer.app);
    await this.webServer.init();
    await this.db.health.start();
    await this.db.init();
    await this.chat.init();
    this.ytPubSub.init();
    this.checker.init();
    this.sender.init();
    this.runtimeStarted = true;
  }

  get isReady() {
    return this.runtimeStarted && this.db.health.isAvailable;
  }

  stop() {
    this.stopPromise ??= this.stopOnce();
    return this.stopPromise;
  }

  private async stopOnce() {
    this.runtimeStarted = false;
    const healthStopped = this.db.health.stop();
    this.ytPubSub.stop();
    this.checker.stop();
    this.sender.stop();
    await Promise.all([healthStopped, this.webServer.close(), this.chat.stop()]);
    await this.db.close();
  }

  getServiceById(id: string) {
    return this.serviceIdService.get(id);
  }
}

const main = new Main();

const shutdown = (exitCode: number) => {
  void main.stop().then(
    () => process.exit(exitCode),
    (err) => {
      debug('shutdown error %o', err);
      process.exit(1);
    },
  );
};

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (err: Error & {code?: string}) => {
  debug('unhandledRejection %o', err);
  if (err.code === 'EFATAL') shutdown(1);
});

main.init().then(
  () => {
    debug('ready');
  },
  (err) => {
    debug('init error', err);
    shutdown(1);
  },
);

export default Main;
