import Router, {
  RouterCallbackQueryReq,
  RouterReq,
  RouterReqWithAnyMessage,
  RouterRes,
  RouterTextReq,
  TCallbackQuery,
  TChat,
  TChatMember,
  TMessage
} from "./router";
import htmlSanitize from "./tools/htmlSanitize";
import ErrorWithCode from "./tools/errorWithCode";
import pageBtnList from "./tools/pageBtnList";
import splitTextByPages from "./tools/splitTextByPages";
import resolvePath from "./tools/resolvePath";
import LogFile from "./logFile";
import ensureMap from "./tools/ensureMap";
import promiseTry from "./tools/promiseTry";
import TimeCache from "./tools/timeCache";
import fs from "fs";
import Main from "./main";
import assertType from "./tools/assertType";
import {ChannelModel, ChatModel, ChatModelWithOptionalChannel, NewChat} from "./db";

const debug = require('debug')('app:Chat');
const jsonStringifyPretty = require("json-stringify-pretty-compact");

interface WithChat {
  chat: ChatModelWithOptionalChannel;
}

interface WithChannels {
  channels: ChannelModel[];
}

class Chat {
  public log = new LogFile('chat');
  private chatIdAdminIdsCache = new TimeCache({maxSize: 100, ttl: 5 * 60 * 1000});
  private router = new Router(this.main);
  constructor(private main: Main) {
    this.main.bot.on('message', (message: TMessage) => {
      this.router.handle('message', message);
    });
    this.main.bot.on('callback_query', (message: TCallbackQuery) => {
      this.router.handle('callback_query', message);
    });

    this.base();
    this.menu();
    this.user();
    this.admin();
  }

  base() {
    this.router.message((req, res, next) => {
      const {migrate_to_chat_id: targetChatId, migrate_from_chat_id: sourceChatId} = req.message;
      if (targetChatId || sourceChatId) {
        return promiseTry(async () => {
          if (targetChatId) {
            await this.main.db.changeChatId('' + req.chatId, '' + targetChatId);
            this.log.write(`[migrate msg] ${req.chatId} > ${targetChatId}`);
          }
          if (sourceChatId) {
            await this.main.db.changeChatId('' + sourceChatId, '' + req.chatId);
            this.log.write(`[migrate msg] ${req.chatId} < ${sourceChatId}`);
          }
        }).then(next, (err) => {
          debug('Process message %s %j error %o', req.chatId, req.message, err);
        });
      } else {
        return next();
      }
    });

    this.router.callback_query((req, res, next) => {
      return this.main.bot.answerCallbackQuery(req.callback_query.id).then(next);
    });

    this.router.textOrCallbackQuery((req, res, next) => {
      if (['group', 'supergroup'].includes(req.chatType)) {
        const message = req.message || req.callback_query.message;
        if (message && message.chat.all_members_are_administrators) {
          return next();
        }

        return promiseTry(() => {
          const adminIds = this.chatIdAdminIdsCache.get(req.chatId);
          if (adminIds) return adminIds;

          return this.main.bot.getChatAdministrators(req.chatId).then((chatMembers: TChatMember[]) => {
            const adminIds = chatMembers.map(chatMember => chatMember.user.id);
            this.chatIdAdminIdsCache.set(req.chatId, adminIds);
            return adminIds;
          });
        }).then((adminIds) => {
          if (adminIds.includes(req.fromId)) {
            next();
          }
        }, (err) => {
          debug('getChatAdministrators error %s %j error %o', req.chatId, req.message, err);
        });
      } else {
        next();
      }
    });

    this.router.textOrCallbackQuery(/(.+)/, (req, res, next) => {
      next();
      if (req.message) {
        this.main.tracker.track(req.chatId, {
          ec: 'command',
          ea: req.command,
          el: req.message.text,
          t: 'event',
        });
      } else
      if (req.callback_query) {
        const data = req.callback_query.data;
        let command = '';
        let m = /(\/[^?\s]+)/.exec(data);
        if (m) {
          command = m[1];
        }
        const msg = Object.assign({}, req.callback_query.message, {
          text: data,
          from: req.callback_query.from
        });
        this.main.tracker.track(msg.chat.id, {
          ec: 'command',
          ea: command,
          el: msg.text,
          t: 'event',
        });
      }
    });

    this.router.text(/\/ping/, (req, res) => {
      return this.main.bot.sendMessage(req.chatId, 'pong').catch((err: any) => {
        debug('%j error %o', req.command, err);
      });
    });
  }

  menu() {
    const sendMenu = (chatId: number, page: number) => {
      const help = this.main.locale.getMessage('help');
      return this.main.bot.sendMessage(chatId, help, {
        disable_web_page_preview: true,
        reply_markup: JSON.stringify({
          inline_keyboard: getMenu(page)
        })
      });
    };

    this.router.text(/\/(start|menu|help)/, (req, res) => {
      return sendMenu(req.chatId, 0).catch((err: any) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.callback_query(/\/menu(?:\/(?<page>\d+))?/, (req, res) => {
      const page = parseInt(req.params.page || '0', 10);
      return this.main.bot.editMessageReplyMarkup(JSON.stringify({
        inline_keyboard: getMenu(page)
      }), {
        chat_id: req.chatId,
        message_id: req.messageId
      }).catch((err: any) => {
        if (/message to edit not found/.test(err.message)) {
          return sendMenu(req.chatId, page);
        } else
        if (/message is not modified/.test(err.message)) {
          // pass
        } else {
          throw err;
        }
      }).catch((err: any) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/top/, (req, res) => {
      const service = this.main.youtube;
      return Promise.all([
        this.main.db.getChatIdChannelIdChatIdCount(),
        this.main.db.getChatIdChannelIdChannelIdCount(),
        this.main.db.getChatIdChannelIdTop10ByServiceId(service.id),
      ]).then(([chatCount, channelCount, serviceTopChannels]) => {
        const lines = [];

        lines.push(this.main.locale.getMessage('users').replace('{count}', '' + chatCount));
        lines.push(this.main.locale.getMessage('channels').replace('{count}', '' + channelCount));

        const name = service.name;
        lines.push('');
        lines.push(`${name}:`);
        serviceTopChannels.forEach(({title, chatCount}, index) => {
          lines.push(chatCount + ' - ' + title);
        });

        return this.main.bot.sendMessage(req.chatId, lines.join('\n'), {
          disable_web_page_preview: true
        });
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    let liveTime = '';
    this.router.textOrCallbackQuery(/\/about/, (req, res) => {
      if (!liveTime) {
        try {
          liveTime = JSON.parse(fs.readFileSync('./liveTime.json', 'utf8')).message;
        } catch (err) {
          debug('Read liveTime.json error! %o', err);
          liveTime = '';
        }
      }

      const message = liveTime.replace(/\$remainFrom\(([^)]+)\)/, (str, date) => {
        const m = /(\d{4}).(\d{2}).(\d{2})/.exec(date);
        if (m) {
          const endTime = (new Date(Number(m[1]), Number(m[2]), Number(m[3]))).getTime();
          const month =Math.trunc((endTime - Date.now()) / 1000 / 60 / 60 / 24 / 30 * 10) / 10;
          return `${month} months`;
        }
        return str;
      });

      return this.main.bot.sendMessage(req.chatId, message).catch((err: any) => {
        debug('%j error %o', req.command, err);
      });
    });
  }

  user() {
    const provideChat = <I extends RouterReq, O extends RouterRes>(req: I, res: O, next: () => void) => {
      return this.main.db.ensureChat('' + req.chatId).then((chat) => {
        Object.assign(req, {chat});
        next();
      }, (err) => {
        debug('ensureChat error! %o', err);
        this.main.bot.sendMessage(req.chatId, 'Oops something went wrong...').catch((err: any) => {
          debug('provideChat sendMessage error: %o', err);
        });
      });
    };

    const provideChannels = <I extends RouterReq, O extends RouterRes>(req: I, res: O, next: () => void) => {
      return this.main.db.getChannelsByChatId('' + req.chatId).then((channels) => {
        Object.assign(req, {channels});
        next();
      }, (err) => {
        debug('ensureChannels error! %o', err);
        this.main.bot.sendMessage(req.chatId, 'Oops something went wrong...').catch((err: any) => {
          debug('provideChannels sendMessage error: %o', err);
        });
      });
    };

    const withChannels = <I extends RouterReq, O extends RouterRes>(req: I, res: O, next: () => void) => {
      assertType<typeof req & WithChannels>(req);

      if (req.channels.length) {
        next();
      } else {
        this.main.bot.sendMessage(req.chatId, this.main.locale.getMessage('emptyServiceList')).catch((err: any) => {
          debug('withChannels sendMessage error: %o', err);
        });
      }
    };

    this.router.callback_query(/\/cancel\/(?<command>[^\s]+)/, (req, res) => {
      const command = req.params.command;

      const cancelText = this.main.locale.getMessage('commandCanceled').replace('{command}', command);
      return this.main.bot.editMessageText(cancelText, {
        chat_id: req.chatId,
        message_id: req.messageId
      }).catch((err: any) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/add(?:\s+(?<query>.+$))?/, provideChat, (req, res) => {
      assertType<typeof req & WithChat>(req);

      const service = this.main.youtube;
      const query = req.params.query;
      let requestedData: string | null = null;

      return promiseTry(() => {
        if (query) {
          return {query: query.trim()};
        }

        const messageText = this.main.locale.getMessage('enterChannelName').replace('{example}', this.main.config.defaultChannelName);
        const cancelText = this.main.locale.getMessage('commandCanceled').replace('{command}', 'add');
        return requestData(req, messageText, cancelText).then(({req, msg}) => {
          requestedData = req.message.text;
          this.main.tracker.track(req.chatId, {
            ec: 'command',
            ea: '/add',
            el: req.message.text,
            t: 'event'
          });
          return {query: req.message.text.trim(), messageId: msg.message_id};
        });
      }).then(({query, messageId}: {query: string, messageId?: number}) => {
        return this.main.db.getChannelCountByChatId('' + req.chatId).then((count) => {
          if (count >= 100) {
            throw new ErrorWithCode('Channels limit exceeded', 'CHANNELS_LIMIT');
          }
        }).then(() => {
          return service.findChannel(query);
        }).then((rawChannel) => {
          return this.main.db.ensureChannel(service, rawChannel).then((channel) => {
            return this.main.db.putChatIdChannelId('' + req.chatId, channel.id).then((created) => {
              return {channel, created};
            });
          });
        }).then(({channel, created}) => {
          let message = null;
          if (!created) {
            message = this.main.locale.getMessage('channelExists');
          } else {
            const {title, url} = channel;
            message = this.main.locale.getMessage('channelAdded')
              .replace('{channelName}', htmlSanitize('a', title, url))
              .replace('{serviceName}', htmlSanitize('', service.name));
          }
          return editOrSendNewMessage(req.chatId, messageId, message, {
            disable_web_page_preview: true,
            parse_mode: 'HTML'
          });
        }, async (err) => {
          let isResolved = false;
          let message = null;
          if ([
            'INCORRECT_CHANNEL_ID',
            'CHANNEL_BY_VIDEO_ID_IS_NOT_FOUND',
            'INCORRECT_USERNAME', 'CHANNEL_BY_USER_IS_NOT_FOUND',
            'QUERY_IS_EMPTY', 'CHANNEL_BY_QUERY_IS_NOT_FOUND',
            'CHANNEL_BY_ID_IS_NOT_FOUND',
          ].includes(err.code)) {
            isResolved = true;
            message = this.main.locale.getMessage('channelIsNotFound').replace('{channelName}', query);
          } else
          if (['VIDEOS_IS_NOT_FOUND', 'CHANNELS_LIMIT', 'CHANNEL_IN_BLACK_LIST'].includes(err.code)) {
            isResolved = true;
            message = err.message;
          } else {
            message = 'Unexpected error';
          }
          await editOrSendNewMessage(req.chatId, messageId, message, {
            disable_web_page_preview: true
          });
          if (!isResolved) {
            throw err;
          }
        });
      }).catch((err) => {
        if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
          // pass
        } else {
          debug('%j %j error %o', req.command, requestedData, err);
        }
      });
    });

    this.router.callback_query(/\/clear\/confirmed/, (req, res) => {
      return this.main.db.deleteChatById('' + req.chatId).then(() => {
        this.log.write(`[deleted] ${req.chatId}, cause: /clear`);
        return this.main.bot.editMessageText(this.main.locale.getMessage('cleared'), {
          chat_id: req.chatId,
          message_id: req.messageId
        });
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/clear/, (req, res) => {
      return this.main.bot.sendMessage(req.chatId, this.main.locale.getMessage('clearSure'), {
        reply_markup: JSON.stringify({
          inline_keyboard: [[{
            text: 'Yes',
            callback_data: '/clear/confirmed'
          }, {
            text: 'No',
            callback_data: '/cancel/clear'
          }]]
        })
      }).catch((err: any) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.callback_query(/\/delete\/(?<channelId>.+)/, (req, res) => {
      const channelId = req.params.channelId;

      return this.main.db.getChannelById(channelId).then((channel) => {
        return this.main.db.deleteChatIdChannelId('' + req.chatId, channelId).then((count) => {
          return {channel, deleted: !!count};
        });
      }).then(({channel, deleted}) => {
        return this.main.bot.editMessageText(this.main.locale.getMessage('channelDeleted').replace('{channelName}', channel.title), {
          chat_id: req.chatId,
          message_id: req.messageId
        });
      }, async (err) => {
        let isResolved = false;
        let message = null;
        if (err.code === 'CHANNEL_IS_NOT_FOUND') {
          isResolved = true;
          message = this.main.locale.getMessage('channelDontExist');
        } else {
          message = 'Unexpected error';
        }
        await this.main.bot.editMessageText(message, {
          chat_id: req.chatId,
          message_id: req.messageId
        });
        if (!isResolved) {
          throw err;
        }
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/delete/, provideChannels, withChannels, (req, res) => {
      assertType<typeof req & WithChannels>(req);

      const channels = req.channels.map((channel) => {
        return [{
          text: channel.title,
          callback_data: `/delete/${channel.id}`
        }];
      });

      const page = pageBtnList(req.query, channels, '/delete', {
        text: 'Cancel',
        callback_data: '/cancel/delete'
      });

      return promiseTry(() => {
        if (req.callback_query && !req.query.rel) {
          return this.main.bot.editMessageReplyMarkup(JSON.stringify({
            inline_keyboard: page
          }), {
            chat_id: req.chatId,
            message_id: req.messageId
          }).catch((err: any) => {
            if (/message is not modified/.test(err.message)) {
              // pass
            } else {
              throw err;
            }
          });
        } else {
          return this.main.bot.sendMessage(req.chatId, this.main.locale.getMessage('selectDelChannel'), {
            reply_markup: JSON.stringify({
              inline_keyboard: page
            })
          });
        }
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.callback_query(/\/unsetChannel/, provideChat, (req, res) => {
      assertType<typeof req & WithChat>(req);

      return promiseTry(() => {
        if (!req.chat.channelId) {
          throw new Error('ChannelId is not set');
        }
        return this.main.db.deleteChatById(req.chat.channelId);
      }).then(() => {
        return this.main.bot.editMessageReplyMarkup(JSON.stringify({
          inline_keyboard: getOptions(req.chat)
        }), {
          chat_id: req.chatId,
          message_id: req.messageId
        }).catch((err: any) => {
          if (/message is not modified/.test(err.message)) {
            return;
          }
          throw err;
        });
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/setChannel(?:\s+(?<channelId>.+))?/, provideChat, (req, res) => {
      assertType<typeof req & WithChat>(req);

      const channelId = req.params.channelId;
      let requestedData: string | null = null;

      return promiseTry(() => {
        if (channelId) {
          return {channelId: channelId.trim()};
        }

        const messageText = this.main.locale.getMessage('telegramChannelEnter');
        const cancelText = this.main.locale.getMessage('commandCanceled').replace('{command}', '\/setChannel');
        return requestData(req, messageText, cancelText).then(({req, msg}) => {
          requestedData = req.message.text;
          this.main.tracker.track(req.chatId, {
            ec: 'command',
            ea: '/setChannel',
            el: req.message.text,
            t: 'event'
          });
          return {channelId: req.message.text.trim(), messageId: msg.message_id};
        });
      }).then(({channelId, messageId}: {channelId: string, messageId?: number}) => {
        return promiseTry(() => {
          if (!/^@\w+$/.test(channelId)) {
            throw new ErrorWithCode('Incorrect channel name', 'INCORRECT_CHANNEL_NAME');
          }

          return this.main.db.getChatById(channelId).then((chat) => {
            throw new ErrorWithCode('Channel already used', 'CHANNEL_ALREADY_USED');
          }, (err) => {
            if (err.code === 'CHAT_IS_NOT_FOUND') {
              // pass
            } else {
              throw err;
            }
          }).then(() => {
            return this.main.bot.sendChatAction(channelId, 'typing').then(() => {
              return this.main.bot.getChat(channelId).then((chat: TChat) => {
                if (chat.type !== 'channel') {
                  throw new ErrorWithCode('This chat type is not supported', 'INCORRECT_CHAT_TYPE');
                }
                const channelId = '@' + chat.username;
                return this.main.db.createChatChannel('' + req.chatId, channelId).then(() => channelId);
              });
            });
          });
        }).then((channelId) => {
          const message = this.main.locale.getMessage('telegramChannelSet').replace('{channelName}', channelId);
          return editOrSendNewMessage(req.chatId, messageId, message).then(() => {
            if (req.callback_query) {
              return this.main.bot.editMessageReplyMarkup(JSON.stringify({
                inline_keyboard: getOptions(req.chat)
              }), {
                chat_id: req.chatId,
                message_id: req.messageId
              }).catch((err: any) => {
                if (/message is not modified/.test(err.message)) {
                  return;
                }
                throw err;
              });
            }
          });
        }, async (err) => {
          let isResolved = false;
          let message = null;
          if (['INCORRECT_CHANNEL_NAME', 'CHANNEL_ALREADY_USED', 'INCORRECT_CHAT_TYPE'].includes(err.code)) {
            isResolved = true;
            message = err.message;
          } else
          if (err.code === 'ETELEGRAM' && /chat not found/.test(err.message)) {
            isResolved = true;
            message = 'Telegram chat is not found!';
          } else
          if (err.code === 'ETELEGRAM' && /bot is not a member of the/.test(err.message)) {
            isResolved = true;
            message = 'Bot is not a member of the channel!';
          } else {
            message = 'Unexpected error';
          }
          await editOrSendNewMessage(req.chatId, req.messageId, message);
          if (!isResolved) {
            throw err;
          }
        });
      }).catch((err) => {
        if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
          // pass
        } else {
          debug('%j %j error %o', req.command, requestedData, err);
        }
      });
    });

    this.router.callback_query(/\/(?<optionsType>options|channelOptions)\/(?<key>[^\/]+)\/(?<value>.+)/, provideChat, (req, res) => {
      assertType<typeof req & WithChat>(req);

      const {optionsType, key, value} = req.params;
      return promiseTry(() => {
        const changes: Partial<NewChat> = {};
        switch (key) {
          case 'isHidePreview': {
            changes.isHidePreview = value === 'true';
            break;
          }
          case 'isMuted': {
            if (optionsType === 'channelOptions') {
              throw new ErrorWithCode('Option is not available for channel', 'UNAVAILABLE_CHANNEL_OPTION');
            }
            changes.isMuted = value === 'true';
            break;
          }
          default: {
            throw new Error('Unknown option filed');
          }
        }
        switch (optionsType) {
          case 'options': {
            Object.assign(req.chat, changes);
            return req.chat.save();
          }
          case 'channelOptions': {
            if (!req.chat.channel) {
              throw new Error('Chat channel is empty');
            }
            Object.assign(req.chat.channel, changes);
            return req.chat.channel.save();
          }
        }
      }).then(() => {
        return this.main.bot.editMessageReplyMarkup(JSON.stringify({
          inline_keyboard: getOptions(req.chat)
        }), {
          chat_id: req.chatId,
          message_id: req.messageId
        }).catch((err: any) => {
          if (/message is not modified/.test(err.message)) {
            return;
          }
          throw err;
        });
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/options/, provideChat, (req, res) => {
      assertType<typeof req & WithChat>(req);

      return promiseTry(() => {
        if (req.callback_query && !req.query.rel) {
          return this.main.bot.editMessageReplyMarkup(JSON.stringify({
            inline_keyboard: getOptions(req.chat)
          }), {
            chat_id: req.chatId,
            message_id: req.messageId
          });
        } else {
          return this.main.bot.sendMessage(req.chatId, 'Options:', {
            reply_markup: JSON.stringify({
              inline_keyboard: getOptions(req.chat)
            })
          });
        }
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/list/, provideChannels, withChannels, (req, res) => {
      assertType<typeof req & WithChannels>(req);

      const serviceIds: string[] = [];
      const serviceIdChannels = new Map<string, ChannelModel[]>();
      req.channels.forEach((channel) => {
        if (!serviceIdChannels.has(channel.service)) {
          serviceIds.push(channel.service);
        }
        const serviceChannels = ensureMap(serviceIdChannels, channel.service, []);
        serviceChannels.push(channel);
      });

      serviceIds.sort((aa, bb) => {
        const a = serviceIdChannels.get(aa)!.length;
        const b = serviceIdChannels.get(bb)!.length;
        return a === b ? 0 : a > b ? -1 : 1;
      });

      const lines: string[] = [];
      serviceIds.forEach((serviceId) => {
        const channelLines = [];
        const service = this.main.getServiceById(serviceId)!;
        channelLines.push(htmlSanitize('b', service.name + ':'));
        serviceIdChannels.get(serviceId)!.forEach((channel) => {
          channelLines.push(htmlSanitize('a', channel.title, channel.url));
        });
        lines.push(channelLines.join('\n'));
      });

      const body = lines.join('\n\n');
      const pageIndex = parseInt(req.query.page || 0);
      const pages = splitTextByPages(body);
      const prevPages = pages.splice(0, pageIndex);
      const pageText = pages.shift() || prevPages.shift();

      const pageControls = [];
      if (pageIndex > 0) {
        pageControls.push({
          text: '<',
          callback_data: '/list' + '?page=' + (pageIndex - 1)
        });
      }
      if (pages.length) {
        pageControls.push({
          text: '>',
          callback_data: '/list' + '?page=' + (pageIndex + 1)
        });
      }

      const options = {
        disable_web_page_preview: true,
        parse_mode: 'HTML',
        reply_markup: JSON.stringify({
          inline_keyboard: [pageControls]
        })
      };

      return promiseTry(() => {
        if (req.callback_query && !req.query.rel) {
          return this.main.bot.editMessageText(pageText, Object.assign(options, {
            chat_id: req.chatId,
            message_id: req.messageId,
          }));
        } else {
          return this.main.bot.sendMessage(req.chatId, pageText, options);
        }
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    const requestData = (req: RouterTextReq | RouterCallbackQueryReq, messageText: string, cancelText: string): Promise<{
      req: RouterTextReq, msg: TMessage
    }> => {
      const {chatId, fromId} = req;
      const options: {[s: string]: any} = {};
      let msgText = messageText;
      if (chatId < 0) {
        msgText += this.main.locale.getMessage('groupNote');
        if (req.callback_query) {
          msgText = '@' + req.callback_query.from.username + ' ' + messageText;
        } else {
          options.reply_to_message_id = req.messageId;
        }
        options.reply_markup = JSON.stringify({
          force_reply: true,
          selective: true,
        });
      }

      return this.main.bot.sendMessage(chatId, msgText, options).then((msg: TMessage) => {
        return this.router.waitResponse<RouterTextReq>(null, {
          event: 'message',
          type: 'text',
          chatId: chatId,
          fromId: fromId,
          throwOnCommand: true
        }, 3 * 60).then(({req, res, next}) => {
          return {req, msg};
        }, async (err) => {
          if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
            await editOrSendNewMessage(chatId, msg.message_id, cancelText);
          }
          throw err;
        });
      });
    };

    const editOrSendNewMessage = (chatId: number, messageId: number|undefined, text: string, form?: object): Promise<TMessage> => {
      return promiseTry(() => {
        if (!messageId) {
          throw new ErrorWithCode('messageId is empty', 'MESSAGE_ID_IS_EMPTY');
        }

        return this.main.bot.editMessageText(text, Object.assign({}, form, {
          chat_id: chatId,
          message_id: messageId,
        }));
      }).catch((err) => {
        if (
          err.code === 'MESSAGE_ID_IS_EMPTY' ||
          /message can't be edited/.test(err.message) ||
          /message to edit not found/.test(err.message)
        ) {
          return this.main.bot.sendMessage(chatId, text, form);
        }
        throw err;
      });
    };
  }

  admin() {
    const isAdmin = <T extends RouterReqWithAnyMessage>(req: T, res: RouterRes, next: () => void) => {
      const adminIds = this.main.config.adminIds || [];
      if (adminIds.includes(req.chatId)) {
        next();
      } else {
        this.main.bot.sendMessage(req.chatId, `Access denied for you (${req.chatId})`).catch((err: any) => {
          debug('isAdmin sendMessage error: %o', err);
        });
      }
    };

    const commands = [
      {name: 'Check chats exists', method: this.main.sender.checkChatsExists},
      {name: 'Check channels exists', method: this.main.checker.checkChannelsExists},
      {name: 'Check channels', method: this.main.checker.check},
      {name: 'Sender check', method: this.main.sender.check},
      {name: 'Active sender threads', method: this.main.sender.getActiveThreads},
      {name: 'Update pubsub', method: this.main.ytPubSub.updateSubscribes},
      {name: 'Clean chats & channels & videos', method: this.main.checker.clean},
      {name: 'Clean pubsub', method: this.main.ytPubSub.clean},
      {name: 'Sync videoId model', method: this.main.db.syncVideoIds},
    ];

    this.router.callback_query(/\/admin\/(?<commandIndex>.+)/, isAdmin, (req, res) => {
      const commandIndex = parseInt(req.params.commandIndex, 10);
      const command = commands[commandIndex];
      return promiseTry((): any => {
        if (!command) {
          throw new ErrorWithCode('Method is not found', 'METHOD_IS_NOT_FOUND');
        }
        return command.method();
      }).then((result) => {
        const resultStr = jsonStringifyPretty({result}, {
          indent: 2
        });
        return this.main.bot.sendMessage(req.chatId, `${command.name} complete!\n${resultStr}`);
      }, async (err) => {
        await this.main.bot.sendMessage(req.chatId, `${command.name} error!`);
        throw err;
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/admin/, isAdmin, (req, res) => {
      type Button = {text: string, callback_data: string};
      return this.main.bot.sendMessage(req.chatId, 'Admin menu', {
        reply_markup: JSON.stringify({
          inline_keyboard: commands.reduce<Button[][]>((menu, {name, method}, index) => {
            const buttons: Button[] = index % 2 ? menu.pop()! : [];
            buttons.push({
              text: name || method.name,
              callback_data: `/admin/${index}`
            });
            menu.push(buttons);
            return menu;
          }, []),
        }),
      }).catch((err: any) => {
        debug('%j error %o', req.command, err);
      });
    });
  }
}

function getMenu(page: number) {
  let menu;
  if (page > 0) {
    menu = [
      [
        {
          text: 'Options',
          callback_data: '/options?rel=menu'
        }
      ],
      [
        {
          text: '<',
          callback_data: '/menu'
        },
        {
          text: 'Top 10',
          callback_data: '/top'
        },
        {
          text: 'About',
          callback_data: '/about'
        }
      ]
    ];
  } else {
    menu = [
      [
        {
          text: 'Show the channel list',
          callback_data: '/list?rel=menu'
        }
      ],
      [
        {
          text: 'Add channel',
          callback_data: '/add'
        },
        {
          text: 'Delete channel',
          callback_data: '/delete?rel=menu'
        },
        {
          text: '>',
          callback_data: '/menu/1'
        }
      ]
    ];
  }

  return menu;
}

function getOptions(chat: ChatModel | ChatModelWithOptionalChannel) {
  const btnList = [];

  if (chat.isHidePreview) {
    btnList.push([{
      text: 'Show preview',
      callback_data: '/options/isHidePreview/false'
    }]);
  } else {
    btnList.push([{
      text: 'Hide preview',
      callback_data: '/options/isHidePreview/true'
    }]);
  }

  if (chat.channelId) {
    btnList.push([{
      text: 'Remove channel (' + chat.channelId + ')',
      callback_data: '/unsetChannel',
    }]);
  } else {
    btnList.push([{
      text: 'Set channel',
      callback_data: '/setChannel',
    }]);
  }

  if (chat.channelId) {
    if (chat.isMuted) {
      btnList.push([{
        text: 'Unmute this chat',
        callback_data: '/options/isMuted/false'
      }]);
    } else {
      btnList.push([{
        text: 'Mute this chat',
        callback_data: '/options/isMuted/true'
      }]);
    }
  }

  if ('channel' in chat && chat.channel) {
    if (chat.channel.isHidePreview) {
      btnList.push([{
        text: 'Show preview for channel',
        callback_data: '/channelOptions/isHidePreview/false'
      }]);
    } else {
      btnList.push([{
        text: 'Hide preview for channel',
        callback_data: '/channelOptions/isHidePreview/true'
      }]);
    }
  }

  return btnList;
}

export default Chat;