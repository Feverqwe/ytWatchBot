import {ParseMode, type SendMessageParams} from 'node-telegram-bot-api';
import {appConfig} from '../appConfig';
import {ChannelModel, ChatModel, ChatModelWithOptionalChannel, NewChat} from '../db';
import Main from '../main';
import LogFile from '../shared/logFile';
import Locale from '../shared/locale';
import createEditOrSendNewMessage from '../shared/chat/editOrSendNewMessage';
import createUserMiddlewares from '../shared/chat/userMiddlewares';
import Router, {
  RouterCallbackQueryReq,
  RouterReq,
  RouterRes,
  RouterTextReq,
} from '../shared/router';
import ensureMap from '../shared/tools/ensureMap';
import ErrorWithCode from '../shared/tools/errorWithCode';
import {getDebug} from '../shared/tools/getDebug';
import htmlSanitize from '../shared/tools/htmlSanitize';
import {ErrEnum, errHandler, passEx} from '../shared/tools/passTgEx';
import splitTextByPages from '../shared/tools/splitTextByPages';
import pageBtnList from '../tools/pageBtnList';
import {tracker} from '../tracker';

const debug = getDebug('app:Chat');

export default function registerUserRoutes(main: Main, router: Router, log: LogFile) {
  const {provideChat, provideChannels, withChannels} = createUserMiddlewares({
    router,
    api: main.bot.api,
    ensureChat: (chatId) => main.db.ensureChat(chatId),
    getChannels: (chatId) => main.db.getChannelsByChatId(chatId),
    getUnknownErrorText: (locale) => locale.m('alert_unknown-error'),
    getEmptyChannelsText: (locale) => locale.m('emptyServiceList'),
  });
  const editOrSendNewMessage = createEditOrSendNewMessage(main.bot.api);

  router.callback_query(/\/cancel\/(?<command>[^\s]+)/, async (req, res) => {
    const {locale} = res;
    const command = req.params.command;

    try {
      await main.bot.api.editMessageText({
        text: locale.m('commandCanceled', {command}),
        chat_id: req.chatId,
        message_id: req.messageId,
      });
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(/\/add(?:\s+(?<query>.+$))?/, provideChat, async (req, res) => {
    const {locale} = res;

    const service = main.youtube;

    let requestedData: string | undefined;

    try {
      const {value: query, messageId} = await askParam({
        messageText: locale.m('enterChannelName', {
          example: appConfig.defaultChannelName,
        }),
        locale,
        req,
        value: req.params.query,
      });
      requestedData = query;

      let channel: ChannelModel;
      let created: boolean;
      try {
        const count = await main.db.getChannelCountByChatId('' + req.chatId);
        if (count >= 100) {
          throw new ErrorWithCode('Channels limit exceeded', 'CHANNELS_LIMIT');
        }

        const rawChannel = await service.findChannel(query);

        channel = await main.db.ensureChannel(service, rawChannel);
        created = await main.db.putChatIdChannelId('' + req.chatId, channel.id);
      } catch (error) {
        const err = error as ErrorWithCode;
        let isResolved = false;
        let message;
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
          ['VIDEOS_IS_NOT_FOUND', 'CHANNELS_LIMIT', 'CHANNEL_IN_BLACK_LIST'].includes(err.code)
        ) {
          isResolved = true;
          if (err.code === 'CHANNEL_IN_BLACK_LIST') {
            message = locale.m('alert_channel-in_blacklist');
          } else if (err.code === 'CHANNELS_LIMIT') {
            message = locale.m('alert_channel-limit-exceeded');
          } else if (err.code === 'VIDEOS_IS_NOT_FOUND') {
            message = locale.m('alert_videos-not-found');
          } else {
            message = err.message;
          }
        } else {
          message = locale.m('alert_unexpected-error');
        }
        await editOrSendNewMessage(req.chatId, messageId, message, {
          link_preview_options: {is_disabled: true},
        });
        if (!isResolved) {
          throw err;
        }
        return;
      }

      let message;
      if (!created) {
        message = locale.m('channelExists');
      } else {
        const {title, url} = channel;
        message = locale.m('channelAdded', {
          channelName: htmlSanitize('a', title, url),
        });
      }

      await editOrSendNewMessage(req.chatId, messageId, message, {
        link_preview_options: {is_disabled: true},
        parse_mode: 'HTML',
      });
    } catch (error) {
      const err = error as ErrorWithCode;
      if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
        // pass
      } else {
        debug('%j %j error %o', req.command, requestedData, err);
      }
    }
  });

  router.callback_query(/\/clear\/confirmed/, async (req, res) => {
    const {locale} = res;

    try {
      await main.db.deleteChatById('' + req.chatId);
      log.write(`[deleted] ${req.chatId}, cause: /clear`);

      await main.bot.api.editMessageText({
        text: locale.m('cleared'),
        chat_id: req.chatId,
        message_id: req.messageId,
      });
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(/\/clear/, async (req, res) => {
    const {locale} = res;

    try {
      await main.bot.api.sendMessage({
        chat_id: req.chatId,
        text: locale.m('clearSure'),
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
      });
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.callback_query(/\/delete\/(?<channelId>.+)/, async (req, res) => {
    const {locale} = res;
    const channelId = req.params.channelId;

    try {
      let channel: ChannelModel;
      try {
        channel = await main.db.getChannelById(channelId);
        await main.db.deleteChatIdChannelId('' + req.chatId, channelId);
      } catch (error) {
        const err = error as ErrorWithCode;
        let isResolved = false;
        let message;
        if (err.code === 'CHANNEL_IS_NOT_FOUND') {
          isResolved = true;
          message = locale.m('channelDontExist');
        } else {
          message = locale.m('alert_unexpected-error');
        }
        await main.bot.api.editMessageText({
          text: message,
          chat_id: req.chatId,
          message_id: req.messageId,
        });
        if (!isResolved) {
          throw err;
        }
        return;
      }

      await main.bot.api.editMessageText({
        text: locale.m('channelDeleted', {
          channelName: channel.title,
        }),
        chat_id: req.chatId,
        message_id: req.messageId,
      });
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(/\/delete/, provideChannels, withChannels, async (req, res) => {
    const {locale} = res;

    try {
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

      if (req.callback_query && !req.query.rel) {
        await passEx(
          () =>
            main.bot.api.editMessageReplyMarkup({
              reply_markup: {
                inline_keyboard: page,
              },
              chat_id: req.chatId,
              message_id: req.messageId,
            }),
          [ErrEnum.MessageNotModified],
        );
      } else {
        await main.bot.api.sendMessage({
          chat_id: req.chatId,
          text: locale.m('selectDelChannel'),
          reply_markup: {
            inline_keyboard: page,
          },
        });
      }
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.callback_query(/\/unsetChannel/, provideChat, async (req, res) => {
    const {locale} = res;

    try {
      if (!req.chat.channelId) {
        throw new Error('ChannelId is not set');
      }
      await main.db.deleteChatById(req.chat.channelId);

      await passEx(
        () =>
          main.bot.api.editMessageReplyMarkup({
            reply_markup: {
              inline_keyboard: getOptions(locale, req.chat),
            },
            chat_id: req.chatId,
            message_id: req.messageId,
          }),
        [ErrEnum.MessageNotModified],
      );
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(
    /\/setChannel(?:\s+(?<channelId>.+))?/,
    provideChat,
    async (req, res) => {
      const {locale} = res;

      let requestedData: string | undefined;

      try {
        const {value: rawChannelId, messageId} = await askParam({
          locale,
          req,
          messageText: locale.m('telegramChannelEnter'),
          value: req.params.channelId,
        });
        requestedData = rawChannelId;

        let channelId: string;

        try {
          if (!/^@\w+$/.test(rawChannelId)) {
            throw new ErrorWithCode('Incorrect channel name', 'INCORRECT_CHANNEL_NAME');
          }

          try {
            await main.db.getChatById(rawChannelId);
            throw new ErrorWithCode('Channel already used', 'CHANNEL_ALREADY_USED');
          } catch (error) {
            const err = error as ErrorWithCode;
            if (err.code === 'CHAT_IS_NOT_FOUND') {
              // pass
            } else {
              throw err;
            }
          }

          await main.bot.api.sendChatAction({
            chat_id: rawChannelId,
            action: 'typing',
          });
          const chat = await main.bot.api.getChat({chat_id: rawChannelId});

          if (chat.type !== 'channel') {
            throw new ErrorWithCode('This chat type is not supported', 'INCORRECT_CHAT_TYPE');
          }

          channelId = '@' + chat.username;
          await main.db.createChatChannel('' + req.chatId, channelId);
        } catch (error) {
          const err = error as ErrorWithCode;
          let isResolved = false;
          let message;
          if (
            ['INCORRECT_CHANNEL_NAME', 'CHANNEL_ALREADY_USED', 'INCORRECT_CHAT_TYPE'].includes(
              err.code,
            )
          ) {
            isResolved = true;
            if (err.code === 'INCORRECT_CHANNEL_NAME') {
              message = locale.m('alert_incorrect-telegram-channel-name');
            } else if (err.code === 'CHANNEL_ALREADY_USED') {
              message = locale.m('alert_telegram-channel-exists');
            } else if (err.code === 'INCORRECT_CHAT_TYPE') {
              message = locale.m('alert_telegram-chat-is-not-supported');
            } else {
              message = err.message;
            }
          } else if (errHandler[ErrEnum.ChatNotFound](err)) {
            isResolved = true;
            message = locale.m('alert_chat-not-found');
          } else if (errHandler[ErrEnum.BotIsNotAMemberOfThe](err)) {
            isResolved = true;
            message = locale.m('alert_bot-is-not-channel-member');
          } else {
            message = locale.m('alert_unexpected-error');
          }
          await editOrSendNewMessage(req.chatId, messageId, message);
          if (!isResolved) {
            throw err;
          }
          return;
        }

        const message = locale.m('telegramChannelSet', {
          channelName: channelId,
        });
        await editOrSendNewMessage(req.chatId, messageId, message);

        if (req.callback_query) {
          await passEx(
            () =>
              main.bot.api.editMessageReplyMarkup({
                reply_markup: {
                  inline_keyboard: getOptions(locale, req.chat),
                },
                chat_id: req.chatId,
                message_id: req.messageId,
              }),
            [ErrEnum.MessageNotModified],
          );
        }
      } catch (error) {
        const err = error as ErrorWithCode;
        if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
          // pass
        } else {
          debug('%j %j error %o', req.command, requestedData, err);
        }
      }
    },
  );

  router.callback_query(
    /\/(?<optionsType>options|channelOptions)\/(?<key>[^\/]+)\/(?<value>.+)/,
    provideChat,
    async (req, res) => {
      const {locale} = res;

      const {optionsType, key, value} = req.params;
      try {
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
          case 'isSkipShortVideos': {
            changes.isSkipShortVideos = value === 'true';
            break;
          }
          default: {
            throw new Error('Unknown option filed');
          }
        }
        switch (optionsType) {
          case 'options': {
            Object.assign(req.chat, changes);
            await req.chat.save();
            break;
          }
          case 'channelOptions': {
            if (!req.chat.channel) {
              throw new Error('Chat channel is empty');
            }
            Object.assign(req.chat.channel, changes);
            await req.chat.channel.save();
            break;
          }
        }

        await passEx(
          () =>
            main.bot.api.editMessageReplyMarkup({
              reply_markup: {
                inline_keyboard: getOptions(locale, req.chat),
              },
              chat_id: req.chatId,
              message_id: req.messageId,
            }),
          [ErrEnum.MessageNotModified],
        );
      } catch (err) {
        debug('%j error %o', req.command, err);
      }
    },
  );

  router.textOrCallbackQuery(/\/options/, provideChat, async (req, res) => {
    const {locale} = res;

    try {
      if (req.callback_query && !req.query.rel) {
        await main.bot.api.editMessageReplyMarkup({
          reply_markup: {
            inline_keyboard: getOptions(locale, req.chat),
          },
          chat_id: req.chatId,
          message_id: req.messageId,
        });
      } else {
        await main.bot.api.sendMessage({
          chat_id: req.chatId,
          text: locale.m('context_options'),
          reply_markup: {
            inline_keyboard: getOptions(locale, req.chat),
          },
        });
      }
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(/\/list/, provideChannels, withChannels, async (req, res) => {
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
      const service = main.getServiceById(serviceId)!;
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
      link_preview_options: {is_disabled: true},
      parse_mode: 'HTML' as ParseMode,
      reply_markup: {
        inline_keyboard: [pageControls],
      },
    };

    try {
      if (req.callback_query && !req.query.rel) {
        await main.bot.api.editMessageText({
          ...options,
          text: pageText,
          chat_id: req.chatId,
          message_id: req.messageId,
        });
      } else {
        await main.bot.api.sendMessage({
          ...options,
          chat_id: req.chatId,
          text: pageText,
        });
      }
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  type AskParamProps = {
    locale: Locale;
    req: RouterTextReq | RouterCallbackQueryReq;
    value: string;
    messageText: string;
  };

  const askParam = async ({locale, req, value, messageText}: AskParamProps) => {
    if (value) {
      return {value: value.trim()};
    }

    const cancelText = locale.m('commandCanceled', {command: req.command});
    const {req: rdReq, msg: rdMsg} = await requestData(locale, req, messageText, cancelText);
    tracker.track(rdReq.chatId, {
      ec: 'command',
      ea: req.command,
      el: rdReq.message.text,
      t: 'event',
    });
    return {value: rdReq.message.text.trim(), messageId: rdMsg.message_id};
  };

  const requestData = async (
    locale: Locale,
    req: RouterTextReq | RouterCallbackQueryReq,
    messageText: string,
    cancelText: string,
  ) => {
    const {chatId, fromId} = req;
    const options: Omit<SendMessageParams, 'chat_id' | 'text'> = {};
    let msgText = messageText;
    if (chatId < 0) {
      msgText += '\n' + locale.m('context_group-note');
      if (req.callback_query) {
        msgText = '@' + req.callback_query.from.username + ' ' + messageText;
      } else {
        options.reply_parameters = {message_id: req.messageId};
      }
      options.reply_markup = {
        force_reply: true,
        selective: true,
      };
    }

    const msg = await main.bot.api.sendMessage({
      ...options,
      chat_id: chatId,
      text: msgText,
    });

    try {
      const {req} = await router.waitResponse<RouterTextReq>(
        null,
        {
          event: 'message',
          type: 'text',
          chatId: chatId,
          fromId: fromId,
          throwOnCommand: true,
        },
        3 * 60,
      );
      return {req, msg};
    } catch (error) {
      const err = error as ErrorWithCode;
      if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
        await editOrSendNewMessage(chatId, msg.message_id, cancelText);
      }
      throw err;
    }
  };
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

  if (chat.isSkipShortVideos) {
    btnList.push([
      {
        text: locale.m('action_disable-skip-short-videos'),
        callback_data: '/options/isSkipShortVideos/false',
      },
    ]);
  } else {
    btnList.push([
      {
        text: locale.m('action_enable-skip-short-videos'),
        callback_data: '/options/isSkipShortVideos/true',
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

    if (chat.channel.isSkipShortVideos) {
      btnList.push([
        {
          text: locale.m('action_disable-skip-short-videos-for-channel'),
          callback_data: '/channelOptions/isSkipShortVideos/false',
        },
      ]);
    } else {
      btnList.push([
        {
          text: locale.m('action_enable-skip-short-videos-for-channel'),
          callback_data: '/channelOptions/isSkipShortVideos/true',
        },
      ]);
    }
  }

  return btnList;
}
