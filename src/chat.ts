import Router, {RouterCallbackQueryReq, RouterReq, RouterReqWithAnyMessage, RouterRes, RouterTextReq} from './router';
import htmlSanitize from './tools/htmlSanitize';
import ErrorWithCode from './tools/errorWithCode';
import pageBtnList from './tools/pageBtnList';
import splitTextByPages from './tools/splitTextByPages';
import LogFile from './logFile';
import ensureMap from './tools/ensureMap';
import promiseTry from './tools/promiseTry';
import TimeCache from './tools/timeCache';
import Main from './main';
import assertType from './tools/assertType';
import {ChannelModel, ChatModel, ChatModelWithOptionalChannel, NewChat} from './db';
import {appConfig} from './appConfig';
import {tracker} from './tracker';
import TelegramBot, {ParseMode} from 'node-telegram-bot-api';
import {getDebug} from './tools/getDebug';
import jsonStringifyPretty from 'json-stringify-pretty-compact';
import Locale from './locale';

const debug = getDebug('app:Chat');

interface WithChat {
  chat: ChatModelWithOptionalChannel;
}

interface WithChannels {
  channels: ChannelModel[];
}

class Chat {
  public log = new LogFile('chat');
  private chatIdAdminIdsCache = new TimeCache<number, number[]>({maxSize: 100, ttl: 5 * 60 * 1000});
  private router: Router;
  constructor(private main: Main) {
    this.router = new Router();
    this.main.bot.on('message', (message) => {
      this.router.handle('message', message);
    });
    this.main.bot.on('callback_query', (message) => {
      this.router.handle('callback_query', message);
    });

    this.base();
    this.menu();
    this.user();
    this.admin();
  }

  async init() {
    const {bot} = this.main;

    const {username} = await bot.getMe();
    if (!username) throw new Error('Bot name is empty');

    this.router.init(bot, username);

    await bot.startPolling();
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

          return this.main.bot
            .getChatAdministrators(req.chatId)
            .then((chatMembers: TelegramBot.ChatMember[]) => {
              const adminIds = chatMembers.map((chatMember) => chatMember.user.id);
              this.chatIdAdminIdsCache.set(req.chatId, adminIds);
              return adminIds;
            });
        }).then(
          (adminIds) => {
            if (req.fromId && adminIds.includes(req.fromId)) {
              next();
            }
          },
          (err) => {
            debug('getChatAdministrators error %s %j error %o', req.chatId, req.message, err);
          },
        );
      } else {
        next();
      }
    });

    this.router.textOrCallbackQuery(/(.+)/, (req, res, next) => {
      next();
      if (req.message) {
        tracker.track(req.chatId, {
          ec: 'command',
          ea: req.command,
          el: req.message.text,
          t: 'event',
        });
      } else if (req.callback_query) {
        const data = req.callback_query.data;
        let command = '';
        let m = /(\/[^?\s]+)/.exec(data);
        if (m) {
          command = m[1];
        }
        const msg = Object.assign({}, req.callback_query.message, {
          text: data,
          from: req.callback_query.from,
        });
        tracker.track(msg.chat.id, {
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
    const sendMenu = (locale: Locale, chatId: number, page: number) => {
      const help = locale.m('help');
      return this.main.bot.sendMessage(chatId, help, {
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: getMenu(locale, page),
        },
      });
    };

    this.router.text(/\/(start|menu|help)/, (req, res) => {
      return sendMenu(res.locale, req.chatId, 0).catch((err: any) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.callback_query(/\/menu(?:\/(?<page>\d+))?/, (req, res) => {
      const {locale} = res;
      const page = parseInt(req.params.page || '0', 10);
      return this.main.bot
        .editMessageReplyMarkup(
          {
            inline_keyboard: getMenu(locale, page),
          },
          {
            chat_id: req.chatId,
            message_id: req.messageId,
          },
        )
        .catch((err: any) => {
          if (/message to edit not found/.test(err.message)) {
            return sendMenu(locale, req.chatId, page);
          } else if (/message is not modified/.test(err.message)) {
            // pass
          } else {
            throw err;
          }
        })
        .catch((err: any) => {
          debug('%j error %o', req.command, err);
        });
    });

    this.router.textOrCallbackQuery(/\/top/, (req, res) => {
      const {locale} = res;
      const service = this.main.youtube;
      return Promise.all([
        this.main.db.getChatIdChannelIdChatIdCount(),
        this.main.db.getChatIdChannelIdChannelIdCount(),
        this.main.db.getChatIdChannelIdTop10ByServiceId(service.id),
      ])
        .then(([chatCount, channelCount, serviceTopChannels]) => {
          const lines = [];

          lines.push(locale.m('users', {count: chatCount}));
          lines.push(locale.m('channels', {count: channelCount}));

          const name = service.name;
          lines.push('');
          lines.push(`${name}:`);
          serviceTopChannels.forEach(({title, chatCount}, index) => {
            lines.push(chatCount + ' - ' + title);
          });

          return this.main.bot.sendMessage(req.chatId, lines.join('\n'), {
            disable_web_page_preview: true,
          });
        })
        .catch((err) => {
          debug('%j error %o', req.command, err);
        });
    });

    this.router.textOrCallbackQuery(/\/about/, (req, res) => {
      const {locale} = res;
      return this.main.bot.sendMessage(req.chatId, locale.m('about')).catch((err: any) => {
        debug('%j error %o', req.command, err);
      });
    });
  }

  user() {
    const provideChat = <I extends RouterReq, O extends RouterRes>(
      req: I,
      res: O,
      next: () => void,
    ) => {
      const {locale} = res;
      const {chatId} = req;
      if (!chatId) return;

      return this.main.db.ensureChat('' + chatId).then(
        (chat) => {
          Object.assign(req, {chat});
          next();
        },
        (err) => {
          debug('ensureChat error! %o', err);
          this.main.bot.sendMessage(chatId, locale.m('alert_unknown-error')).catch((err: any) => {
            debug('provideChat sendMessage error: %o', err);
          });
        },
      );
    };

    const provideChannels = <I extends RouterReq, O extends RouterRes>(
      req: I,
      res: O,
      next: () => void,
    ) => {
      const {locale} = res;
      const {chatId} = req;
      if (!chatId) return;

      return this.main.db.getChannelsByChatId('' + chatId).then(
        (channels) => {
          Object.assign(req, {channels});
          next();
        },
        (err) => {
          debug('ensureChannels error! %o', err);
          this.main.bot.sendMessage(chatId, locale.m('alert_unknown-error')).catch((err: any) => {
            debug('provideChannels sendMessage error: %o', err);
          });
        },
      );
    };

    const withChannels = <I extends RouterReq, O extends RouterRes>(
      req: I,
      res: O,
      next: () => void,
    ) => {
      const {locale} = res;
      const {chatId} = req;
      if (!chatId) return;

      assertType<typeof req & WithChannels>(req);

      if (req.channels.length) {
        next();
      } else {
        this.main.bot.sendMessage(chatId, locale.m('emptyServiceList')).catch((err: any) => {
          debug('withChannels sendMessage error: %o', err);
        });
      }
    };

    this.router.callback_query(/\/cancel\/(?<command>[^\s]+)/, (req, res) => {
      const {locale} = res;
      const command = req.params.command;

      const cancelText = locale.m('commandCanceled', {command});
      return this.main.bot
        .editMessageText(cancelText, {
          chat_id: req.chatId,
          message_id: req.messageId,
        })
        .catch((err: any) => {
          debug('%j error %o', req.command, err);
        });
    });

    this.router.textOrCallbackQuery(/\/add(?:\s+(?<query>.+$))?/, provideChat, (req, res) => {
      assertType<typeof req & WithChat>(req);
      const {locale} = res;

      const service = this.main.youtube;
      const query = req.params.query;
      let requestedData: string | null = null;

      return promiseTry(() => {
        if (query) {
          return {query: query.trim()};
        }

        const messageText = locale.m('enterChannelName', {
          example: appConfig.defaultChannelName,
        });
        const cancelText = locale.m('commandCanceled', {command: 'add'});
        return requestData(req, locale, messageText, cancelText).then(({req, msg}) => {
          requestedData = req.message.text;
          tracker.track(req.chatId, {
            ec: 'command',
            ea: '/add',
            el: req.message.text,
            t: 'event',
          });
          return {query: req.message.text.trim(), messageId: msg.message_id};
        });
      })
        .then(({query, messageId}: {query: string; messageId?: number}) => {
          return this.main.db
            .getChannelCountByChatId('' + req.chatId)
            .then((count) => {
              if (count >= 100) {
                throw new ErrorWithCode('Channels limit exceeded', 'CHANNELS_LIMIT');
              }
            })
            .then(() => {
              return service.findChannel(query);
            })
            .then((rawChannel) => {
              return this.main.db.ensureChannel(service, rawChannel).then((channel) => {
                return this.main.db
                  .putChatIdChannelId('' + req.chatId, channel.id)
                  .then((created) => {
                    return {channel, created};
                  });
              });
            })
            .then(
              ({channel, created}) => {
                let message = null;
                if (!created) {
                  message = locale.m('channelExists');
                } else {
                  const {title, url} = channel;
                  message = locale.m('channelAdded', {
                    channelName: htmlSanitize('a', title, url),
                    serviceName: htmlSanitize('', service.name),
                  });
                }
                return editOrSendNewMessage(req.chatId, messageId, message, {
                  disable_web_page_preview: true,
                  parse_mode: 'HTML',
                });
              },
              async (err) => {
                let isResolved = false;
                let message = null;
                if (
                  [
                    'INCORRECT_CHANNEL_ID',
                    'CHANNEL_BY_VIDEO_ID_IS_NOT_FOUND',
                    'INCORRECT_USERNAME',
                    'CHANNEL_BY_USER_IS_NOT_FOUND',
                    'QUERY_IS_EMPTY',
                    'CHANNEL_BY_QUERY_IS_NOT_FOUND',
                    'CHANNEL_BY_ID_IS_NOT_FOUND',
                  ].includes(err.code)
                ) {
                  isResolved = true;
                  message = locale.m('channelIsNotFound', {
                    channelName: query,
                  });
                } else if (
                  ['VIDEOS_IS_NOT_FOUND', 'CHANNELS_LIMIT', 'CHANNEL_IN_BLACK_LIST'].includes(
                    err.code,
                  )
                ) {
                  isResolved = true;
                  message = err.message;
                } else {
                  message = locale.m('alert_unexpected-error');
                }
                await editOrSendNewMessage(req.chatId, messageId, message, {
                  disable_web_page_preview: true,
                });
                if (!isResolved) {
                  throw err;
                }
              },
            );
        })
        .catch((err) => {
          if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
            // pass
          } else {
            debug('%j %j error %o', req.command, requestedData, err);
          }
        });
    });

    this.router.callback_query(/\/clear\/confirmed/, (req, res) => {
      const {locale} = res;
      return this.main.db
        .deleteChatById('' + req.chatId)
        .then(() => {
          this.log.write(`[deleted] ${req.chatId}, cause: /clear`);
          return this.main.bot.editMessageText(locale.m('cleared'), {
            chat_id: req.chatId,
            message_id: req.messageId,
          });
        })
        .catch((err) => {
          debug('%j error %o', req.command, err);
        });
    });

    this.router.textOrCallbackQuery(/\/clear/, (req, res) => {
      const {locale} = res;
      return this.main.bot
        .sendMessage(req.chatId, locale.m('clearSure'), {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: 'Yes',
                  callback_data: '/clear/confirmed',
                },
                {
                  text: 'No',
                  callback_data: '/cancel/clear',
                },
              ],
            ],
          },
        })
        .catch((err: any) => {
          debug('%j error %o', req.command, err);
        });
    });

    this.router.callback_query(/\/delete\/(?<channelId>.+)/, (req, res) => {
      const {locale} = res;
      const channelId = req.params.channelId;

      return this.main.db
        .getChannelById(channelId)
        .then((channel) => {
          return this.main.db.deleteChatIdChannelId('' + req.chatId, channelId).then((count) => {
            return {channel, deleted: !!count};
          });
        })
        .then(
          ({channel, deleted}) => {
            return this.main.bot.editMessageText(
              locale.m('channelDeleted', {
                channelName: channel.title,
              }),
              {
                chat_id: req.chatId,
                message_id: req.messageId,
              },
            );
          },
          async (err) => {
            let isResolved = false;
            let message;
            if (err.code === 'CHANNEL_IS_NOT_FOUND') {
              isResolved = true;
              message = locale.m('channelDontExist');
            } else {
              message = locale.m('alert_unexpected-error');
            }
            await this.main.bot.editMessageText(message, {
              chat_id: req.chatId,
              message_id: req.messageId,
            });
            if (!isResolved) {
              throw err;
            }
          },
        )
        .catch((err) => {
          debug('%j error %o', req.command, err);
        });
    });

    this.router.textOrCallbackQuery(/\/delete/, provideChannels, withChannels, (req, res) => {
      const {locale} = res;
      assertType<typeof req & WithChannels>(req);

      const channels = req.channels.map((channel) => {
        return [
          {
            text: channel.title,
            callback_data: `/delete/${channel.id}`,
          },
        ];
      });

      const page = pageBtnList(req.query, channels, '/delete', {
        text: 'Cancel',
        callback_data: '/cancel/delete',
      });

      return promiseTry(() => {
        if (req.callback_query && !req.query.rel) {
          return this.main.bot
            .editMessageReplyMarkup(
              {
                inline_keyboard: page,
              },
              {
                chat_id: req.chatId,
                message_id: req.messageId,
              },
            )
            .catch((err: any) => {
              if (/message is not modified/.test(err.message)) {
                // pass
              } else {
                throw err;
              }
            });
        } else {
          return this.main.bot.sendMessage(req.chatId, locale.m('selectDelChannel'), {
            reply_markup: {
              inline_keyboard: page,
            },
          });
        }
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.callback_query(/\/unsetChannel/, provideChat, (req, res) => {
      const {locale} = res;
      assertType<typeof req & WithChat>(req);

      return promiseTry(() => {
        if (!req.chat.channelId) {
          throw new Error('ChannelId is not set');
        }
        return this.main.db.deleteChatById(req.chat.channelId);
      })
        .then(() => {
          return this.main.bot
            .editMessageReplyMarkup(
              {
                inline_keyboard: getOptions(locale, req.chat),
              },
              {
                chat_id: req.chatId,
                message_id: req.messageId,
              },
            )
            .catch((err: any) => {
              if (/message is not modified/.test(err.message)) {
                return;
              }
              throw err;
            });
        })
        .catch((err) => {
          debug('%j error %o', req.command, err);
        });
    });

    this.router.textOrCallbackQuery(
      /\/setChannel(?:\s+(?<channelId>.+))?/,
      provideChat,
      (req, res) => {
        const {locale} = res;
        assertType<typeof req & WithChat>(req);

        const channelId = req.params.channelId;
        let requestedData: string | null = null;

        return promiseTry(() => {
          if (channelId) {
            return {channelId: channelId.trim()};
          }

          const messageText = locale.m('telegramChannelEnter');
          const cancelText = locale.m('commandCanceled', {
            command: '/setChannel',
          });
          return requestData(req, locale, messageText, cancelText).then(({req, msg}) => {
            requestedData = req.message.text;
            tracker.track(req.chatId, {
              ec: 'command',
              ea: '/setChannel',
              el: req.message.text,
              t: 'event',
            });
            return {channelId: req.message.text.trim(), messageId: msg.message_id};
          });
        })
          .then(({channelId, messageId}: {channelId: string; messageId?: number}) => {
            return promiseTry(() => {
              if (!/^@\w+$/.test(channelId)) {
                throw new ErrorWithCode('Incorrect channel name', 'INCORRECT_CHANNEL_NAME');
              }

              return this.main.db
                .getChatById(channelId)
                .then(
                  (chat) => {
                    throw new ErrorWithCode('Channel already used', 'CHANNEL_ALREADY_USED');
                  },
                  (err) => {
                    if (err.code === 'CHAT_IS_NOT_FOUND') {
                      // pass
                    } else {
                      throw err;
                    }
                  },
                )
                .then(() => {
                  return this.main.bot.sendChatAction(channelId, 'typing').then(() => {
                    return this.main.bot.getChat(channelId).then((chat) => {
                      if (chat.type !== 'channel') {
                        throw new ErrorWithCode(
                          'This chat type is not supported',
                          'INCORRECT_CHAT_TYPE',
                        );
                      }
                      const channelId = '@' + chat.username;
                      return this.main.db
                        .createChatChannel('' + req.chatId, channelId)
                        .then(() => channelId);
                    });
                  });
                });
            }).then(
              (channelId) => {
                const message = locale.m('telegramChannelSet', {
                  channelName: channelId,
                });
                return editOrSendNewMessage(req.chatId, messageId, message).then(() => {
                  if (req.callback_query) {
                    return this.main.bot
                      .editMessageReplyMarkup(
                        {
                          inline_keyboard: getOptions(locale, req.chat),
                        },
                        {
                          chat_id: req.chatId,
                          message_id: req.messageId,
                        },
                      )
                      .catch((err: any) => {
                        if (/message is not modified/.test(err.message)) {
                          return;
                        }
                        throw err;
                      });
                  }
                });
              },
              async (err) => {
                let isResolved = false;
                let message;
                if (
                  [
                    'INCORRECT_CHANNEL_NAME',
                    'CHANNEL_ALREADY_USED',
                    'INCORRECT_CHAT_TYPE',
                  ].includes(err.code)
                ) {
                  isResolved = true;
                  message = err.message;
                } else if (err.code === 'ETELEGRAM' && /chat not found/.test(err.message)) {
                  isResolved = true;
                  message = locale.m('alert_chat-not-found');
                } else if (
                  err.code === 'ETELEGRAM' &&
                  /bot is not a member of the/.test(err.message)
                ) {
                  isResolved = true;
                  message = locale.m('alert_bot-is-not-channel-member');
                } else {
                  message = locale.m('alert_unexpected-error');
                }
                await editOrSendNewMessage(req.chatId, req.messageId, message);
                if (!isResolved) {
                  throw err;
                }
              },
            );
          })
          .catch((err) => {
            if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
              // pass
            } else {
              debug('%j %j error %o', req.command, requestedData, err);
            }
          });
      },
    );

    this.router.callback_query(
      /\/(?<optionsType>options|channelOptions)\/(?<key>[^\/]+)\/(?<value>.+)/,
      provideChat,
      (req, res) => {
        const {locale} = res;
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
                throw new ErrorWithCode(
                  'Option is not available for channel',
                  'UNAVAILABLE_CHANNEL_OPTION',
                );
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
        })
          .then(() => {
            return this.main.bot
              .editMessageReplyMarkup(
                {
                  inline_keyboard: getOptions(locale, req.chat),
                },
                {
                  chat_id: req.chatId,
                  message_id: req.messageId,
                },
              )
              .catch((err: any) => {
                if (/message is not modified/.test(err.message)) {
                  return;
                }
                throw err;
              });
          })
          .catch((err) => {
            debug('%j error %o', req.command, err);
          });
      },
    );

    this.router.textOrCallbackQuery(/\/options/, provideChat, (req, res) => {
      const {locale} = res;
      assertType<typeof req & WithChat>(req);

      return promiseTry(() => {
        if (req.callback_query && !req.query.rel) {
          return this.main.bot.editMessageReplyMarkup(
            {
              inline_keyboard: getOptions(locale, req.chat),
            },
            {
              chat_id: req.chatId,
              message_id: req.messageId,
            },
          );
        } else {
          return this.main.bot.sendMessage(req.chatId, locale.m('context_options'), {
            reply_markup: {
              inline_keyboard: getOptions(locale, req.chat),
            },
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
      const pageText = pages.shift() || prevPages.shift() || '';

      const pageControls = [];
      if (pageIndex > 0) {
        pageControls.push({
          text: '<',
          callback_data: '/list' + '?page=' + (pageIndex - 1),
        });
      }
      if (pages.length) {
        pageControls.push({
          text: '>',
          callback_data: '/list' + '?page=' + (pageIndex + 1),
        });
      }

      const options = {
        disable_web_page_preview: true,
        parse_mode: 'HTML' as ParseMode,
        reply_markup: {
          inline_keyboard: [pageControls],
        },
      };

      return promiseTry(() => {
        if (req.callback_query && !req.query.rel) {
          return this.main.bot.editMessageText(pageText, {
            ...options,
            chat_id: req.chatId,
            message_id: req.messageId,
          });
        } else {
          return this.main.bot.sendMessage(req.chatId, pageText, options);
        }
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    const requestData = (
      req: RouterTextReq | RouterCallbackQueryReq,
      locale: Locale,
      messageText: string,
      cancelText: string,
    ): Promise<{
      req: RouterTextReq;
      msg: TelegramBot.Message;
    }> => {
      const {chatId, fromId} = req;
      const options: {[s: string]: any} = {};
      let msgText = messageText;
      if (chatId < 0) {
        msgText += locale.m('groupNote');
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

      return this.main.bot.sendMessage(chatId, msgText, options).then((msg) => {
        return this.router
          .waitResponse<RouterTextReq>(
            null,
            {
              event: 'message',
              type: 'text',
              chatId: chatId,
              fromId: fromId,
              throwOnCommand: true,
            },
            3 * 60,
          )
          .then(
            ({req, res, next}) => {
              return {req, msg};
            },
            async (err) => {
              if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
                await editOrSendNewMessage(chatId, msg.message_id, cancelText);
              }
              throw err;
            },
          );
      });
    };

    const editOrSendNewMessage = (
      chatId: number,
      messageId: number | undefined,
      text: string,
      form?: object,
    ): Promise<number> => {
      return promiseTry(async () => {
        if (!messageId) {
          throw new ErrorWithCode('messageId is empty', 'MESSAGE_ID_IS_EMPTY');
        }

        const result = await this.main.bot.editMessageText(
          text,
          Object.assign({}, form, {
            chat_id: chatId,
            message_id: messageId,
          }),
        );

        if (typeof result === 'object') {
          return result.message_id;
        }

        return messageId;
      }).catch((err) => {
        if (
          err.code === 'MESSAGE_ID_IS_EMPTY' ||
          /message can't be edited/.test(err.message) ||
          /message to edit not found/.test(err.message)
        ) {
          return this.main.bot.sendMessage(chatId, text, form).then(({message_id}) => message_id);
        }
        throw err;
      });
    };
  }

  admin() {
    const isAdmin = <T extends RouterReqWithAnyMessage>(
      req: T,
      res: RouterRes,
      next: () => void,
    ) => {
      const {locale} = res;
      const adminIds = appConfig.adminIds;
      if (adminIds.includes(req.chatId)) {
        next();
      } else {
        this.main.bot
          .sendMessage(
            req.chatId,
            locale.m('alert_access-denied', {
              chat: req.chatId,
            }),
          )
          .catch((err: any) => {
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
      {name: 'Update pubsub', method: this.main.webServer.ytPubSub.updateSubscribes},
      {name: 'Clean chats & channels & videos', method: this.main.checker.clean},
      {name: 'Clean pubsub', method: this.main.webServer.ytPubSub.clean},
    ];

    this.router.callback_query(/\/admin\/(?<commandIndex>.+)/, isAdmin, (req, res) => {
      const {locale} = res;
      const commandIndex = parseInt(req.params.commandIndex, 10);
      const command = commands[commandIndex];
      return promiseTry((): any => {
        if (!command) {
          throw new ErrorWithCode('Method is not found', 'METHOD_IS_NOT_FOUND');
        }
        return command.method();
      })
        .then(
          (result) => {
            const resultStr = jsonStringifyPretty(
              {result},
              {
                indent: 2,
              },
            );
            return this.main.bot.sendMessage(
              req.chatId,
              `${locale.m('alert_command-complete', {
                command: command.name,
              })}\n${resultStr}`,
            );
          },
          async (err) => {
            await this.main.bot.sendMessage(
              req.chatId,
              locale.m('alert_command-error', {
                command: command.name,
              }),
            );
            throw err;
          },
        )
        .catch((err) => {
          debug('%j error %o', req.command, err);
        });
    });

    this.router.textOrCallbackQuery(/\/admin/, isAdmin, (req, res) => {
      const {locale} = res;
      type Button = {text: string; callback_data: string};
      return this.main.bot
        .sendMessage(req.chatId, locale.m('title_admin-menu'), {
          reply_markup: {
            inline_keyboard: commands.reduce<Button[][]>((menu, {name, method}, index) => {
              const buttons: Button[] = index % 2 ? menu.pop()! : [];
              buttons.push({
                text: name || method.name,
                callback_data: `/admin/${index}`,
              });
              menu.push(buttons);
              return menu;
            }, []),
          },
        })
        .catch((err: any) => {
          debug('%j error %o', req.command, err);
        });
    });
  }
}

function getMenu(locale: Locale, page: number) {
  let menu;
  if (page > 0) {
    menu = [
      [
        {
          text: locale.m('action_options'),
          callback_data: '/options?rel=menu',
        },
      ],
      [
        {
          text: locale.m('action_prev-page'),
          callback_data: '/menu',
        },
        {
          text: locale.m('action_top'),
          callback_data: '/top',
        },
        {
          text: locale.m('action_about'),
          callback_data: '/about',
        },
      ],
    ];
  } else {
    menu = [
      [
        {
          text: locale.m('action_show-channels'),
          callback_data: '/list?rel=menu',
        },
      ],
      [
        {
          text: locale.m('action_add_channel'),
          callback_data: '/add',
        },
        {
          text: locale.m('action_delete-channel'),
          callback_data: '/delete?rel=menu',
        },
        {
          text: locale.m('action_next-page'),
          callback_data: '/menu/1',
        },
      ],
    ];
  }

  return menu;
}

function getOptions(locale: Locale, chat: ChatModel | ChatModelWithOptionalChannel) {
  const btnList = [];

  if (chat.isHidePreview) {
    btnList.push([
      {
        text: locale.m('action_show-preview'),
        callback_data: '/options/isHidePreview/false',
      },
    ]);
  } else {
    btnList.push([
      {
        text: locale.m('action_hide-preview'),
        callback_data: '/options/isHidePreview/true',
      },
    ]);
  }

  if (chat.channelId) {
    btnList.push([
      {
        text: locale.m('action_remove-tg-channel', {
          channel: chat.channelId,
        }),
        callback_data: '/unsetChannel',
      },
    ]);
  } else {
    btnList.push([
      {
        text: locale.m('action_set-tg-channel'),
        callback_data: '/setChannel',
      },
    ]);
  }

  if (chat.channelId) {
    if (chat.isMuted) {
      btnList.push([
        {
          text: locale.m('action_unmute-chat'),
          callback_data: '/options/isMuted/false',
        },
      ]);
    } else {
      btnList.push([
        {
          text: locale.m('action_mute-chat'),
          callback_data: '/options/isMuted/true',
        },
      ]);
    }
  }

  if ('channel' in chat && chat.channel) {
    if (chat.channel.isHidePreview) {
      btnList.push([
        {
          text: locale.m('action_show-preview-for-channel'),
          callback_data: '/channelOptions/isHidePreview/false',
        },
      ]);
    } else {
      btnList.push([
        {
          text: locale.m('action_hide-preview-for-channel'),
          callback_data: '/channelOptions/isHidePreview/true',
        },
      ]);
    }
  }

  return btnList;
}

export default Chat;
