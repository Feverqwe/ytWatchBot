import {Readable, Stream} from 'node:stream';
import {
  Bot,
  InputFile,
  type CallbackQuery,
  type EditMessageReplyMarkupParams,
  type EditMessageReplyMarkupResult,
  type EditMessageTextParams,
  type EditMessageTextResult,
  type GetChatAdministratorsResult,
  type GetChatResult,
  type Message,
  type ReplyMarkup,
  type SendMessageParams,
  type SendPhotoParams,
  type SendPhotoResult,
  type User,
} from 'node-telegram-bot-api';
import RateLimit2 from './rateLimit2';
import {getDebug} from './getDebug';

const debug = getDebug('app:telegramBotApi');

type LegacyReplyOptions = {
  disable_web_page_preview?: boolean;
  link_preview_options?: SendMessageParams['link_preview_options'];
  reply_parameters?: SendMessageParams['reply_parameters'];
  reply_to_message_id?: number;
  reply_markup?: ReplyMarkup | string;
};

type SendMessageOptions = Omit<SendMessageParams, 'chat_id' | 'reply_markup' | 'text'> &
  LegacyReplyOptions;
type SendPhotoOptions = Omit<SendPhotoParams, 'chat_id' | 'photo' | 'reply_markup'> &
  LegacyReplyOptions;
type FileOptions = {contentType?: string; filename?: string};

type MigratedReplyOptions<T> = Omit<
  T,
  'disable_web_page_preview' | 'reply_markup' | 'reply_to_message_id'
> & {
  reply_markup?: Exclude<T extends {reply_markup?: infer R} ? R : never, string>;
};

function migrateLegacyOptions<T extends LegacyReplyOptions>(options: T): MigratedReplyOptions<T> {
  const {disable_web_page_preview, reply_markup, reply_to_message_id, ...migrated} = options;

  return {
    ...migrated,
    ...(disable_web_page_preview === undefined
      ? {}
      : {link_preview_options: {is_disabled: disable_web_page_preview}}),
    ...(reply_to_message_id === undefined
      ? {}
      : {reply_parameters: {message_id: reply_to_message_id}}),
    ...(reply_markup === undefined
      ? {}
      : {
          reply_markup:
            typeof reply_markup === 'string'
              ? (JSON.parse(reply_markup) as Exclude<
                  T extends {reply_markup?: infer R} ? R : never,
                  string
                >)
              : reply_markup,
        }),
  } as unknown as MigratedReplyOptions<T>;
}

function asInputFile(photo: string | Stream | Buffer, fileOptions?: FileOptions) {
  if (typeof photo === 'string') return photo;

  if (Buffer.isBuffer(photo)) {
    return new InputFile(photo, fileOptions);
  }

  return new InputFile(Readable.toWeb(photo as Readable), fileOptions);
}

export class TelegramBotWrapped {
  private readonly bot: Bot;
  private readonly sendLimit = new RateLimit2(30);
  private readonly chatActionLimit = new RateLimit2(30);

  constructor(token: string) {
    this.bot = new Bot(token);
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

  getMe(): Promise<User> {
    return this.bot.api.getMe();
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

  answerCallbackQuery(callbackQueryId: string): Promise<boolean> {
    return this.bot.api.answerCallbackQuery({callback_query_id: callbackQueryId});
  }

  getChatAdministrators(chatId: number | string): Promise<GetChatAdministratorsResult> {
    return this.bot.api.getChatAdministrators({chat_id: chatId});
  }

  getChat(chatId: number | string): Promise<GetChatResult> {
    return this.bot.api.getChat({chat_id: chatId});
  }

  sendMessage(
    chatId: number | string,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<Message> {
    return this.sendLimit.run(() =>
      this.bot.api.sendMessage({
        ...migrateLegacyOptions(options),
        chat_id: chatId,
        text,
      }),
    );
  }

  sendPhoto(
    chatId: number | string,
    photo: string | Stream | Buffer,
    options: SendPhotoOptions = {},
    fileOptions?: FileOptions,
  ): Promise<SendPhotoResult> {
    return this.bot.api.sendPhoto({
      ...migrateLegacyOptions(options),
      chat_id: chatId,
      photo: asInputFile(photo, fileOptions),
    });
  }

  sendPhotoQuote(
    chatId: number | string,
    photo: string | Stream | Buffer,
    options: SendPhotoOptions = {},
    fileOptions?: FileOptions,
  ): Promise<SendPhotoResult> {
    return this.sendLimit.run(() => this.sendPhoto(chatId, photo, options, fileOptions));
  }

  sendChatAction(
    chatId: number | string,
    action: Parameters<Bot['api']['sendChatAction']>[0]['action'],
  ): Promise<boolean> {
    return this.chatActionLimit.run(() => this.bot.api.sendChatAction({chat_id: chatId, action}));
  }

  editMessageText(
    text: string,
    options: Omit<EditMessageTextParams, 'text'>,
  ): Promise<EditMessageTextResult> {
    return this.bot.api.editMessageText({...migrateLegacyOptions(options), text});
  }

  editMessageReplyMarkup(
    replyMarkup: EditMessageReplyMarkupParams['reply_markup'],
    options: Omit<EditMessageReplyMarkupParams, 'reply_markup'>,
  ): Promise<EditMessageReplyMarkupResult> {
    return this.bot.api.editMessageReplyMarkup({...options, reply_markup: replyMarkup});
  }
}

export const getTelegramBot = (token: string) => new TelegramBotWrapped(token);
