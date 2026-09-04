import {Bot, type Api, type CallbackQuery, type Message} from 'node-telegram-bot-api';
import RateLimit2 from './rateLimit2';
import {getDebug} from './getDebug';

const debug = getDebug('app:telegramBotApi');

type DirectApi = Pick<
  Api,
  | 'answerCallbackQuery'
  | 'editMessageReplyMarkup'
  | 'editMessageText'
  | 'getChat'
  | 'getChatAdministrators'
  | 'getMe'
  | 'sendChatAction'
  | 'sendMessage'
  | 'sendPhoto'
>;

export class TelegramBotWrapped {
  private readonly bot: Bot;
  readonly api: DirectApi;
  private readonly sendLimit = new RateLimit2(30);
  private readonly chatActionLimit = new RateLimit2(30);

  constructor(token: string) {
    this.bot = new Bot(token);
    const api = this.bot.api;
    this.api = {
      answerCallbackQuery: api.answerCallbackQuery.bind(api),
      editMessageReplyMarkup: api.editMessageReplyMarkup.bind(api),
      editMessageText: api.editMessageText.bind(api),
      getChat: api.getChat.bind(api),
      getChatAdministrators: api.getChatAdministrators.bind(api),
      getMe: api.getMe.bind(api),
      sendChatAction: (params, signal) =>
        this.chatActionLimit.run(() => api.sendChatAction(params, signal)),
      sendMessage: (params, signal) => this.sendLimit.run(() => api.sendMessage(params, signal)),
      sendPhoto: (params, signal) => this.sendLimit.run(() => api.sendPhoto(params, signal)),
    };
    this.bot.catch((err) => {
      debug('handler error %o', err);
    });
  }

  on(event: 'message', listener: (message: Message) => void): this;
  on(event: 'callback_query', listener: (query: CallbackQuery) => void): this;
  on(
    event: 'message' | 'callback_query',
    listener: ((message: Message) => void) | ((query: CallbackQuery) => void),
  ) {
    this.bot.on(event, (ctx) => {
      const payload = event === 'message' ? ctx.message : ctx.callbackQuery;
      if (payload) {
        (listener as (payload: Message | CallbackQuery) => void)(payload);
      }
    });
    return this;
  }

  async startPolling(): Promise<void> {
    void this.bot
      .startPolling(undefined, {
        onError: (err) => debug('polling error, retrying: %o', err),
      })
      .catch((err) => {
        debug('polling stopped: %o', err);
      });
  }
}

export const getTelegramBot = (token: string) => new TelegramBotWrapped(token);
