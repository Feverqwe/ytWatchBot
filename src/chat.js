import Router from "./router";
import htmlSanitize from "./tools/htmlSanitize";
import ErrorWithCode from "./tools/errorWithCode";
import pageBtnList from "./tools/pageBtnList";

const debug = require('debug')('app:Chat');
const fs = require('fs');

class Chat {
  constructor(/**Main*/main) {
    this.main = main;

    this.router = new Router(main);

    /**@type {function(RegExp, ...function(RouterReq, function()))}*/
    this.router.textOrCallbackQuery = this.router.custom(['text', 'callback_query']);

    this.main.bot.on('message', (message) => {
      this.router.handle('message', message);
    });
    this.main.bot.on('callback_query', (message) => {
      this.router.handle('callback_query', message);
    });

    this.base();
    this.menu();
    this.user();
  }

  base() {
    this.router.textOrCallbackQuery(/(.+)/, (/**RouterReq*/req, next) => {
      next();
      if (req.message) {
        this.main.tracker.track(req.chatId, {
          ec: 'command',
          ea: req.command,
          el: req.message.text,
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
        });
      }
    });

    this.router.text(/\/ping/, (req) => {
      this.main.bot.sendMessage(req.chatId, 'pong').catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });
  }

  menu() {
    this.router.text(/\/(start|menu|help)/, (req) => {
      const help = this.main.locale.getMessage('help');
      this.main.bot.sendMessage(req.chatId, help, {
        disable_web_page_preview: true,
        reply_markup: JSON.stringify({
          inline_keyboard: getMenu(0)
        })
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.callback_query(/\/menu(?:\/(?<page>\d+))?/, (req) => {
      this.main.bot.editMessageReplyMarkup(JSON.stringify({
        inline_keyboard: getMenu(parseInt(req.params.page || 0, 10))
      }), {
        chat_id: req.chatId,
        message_id: req.messageId
      }).catch((err) => {
        if (/message is not modified/.test(err.message)) {
          // pass
        } else {
          debug('%j error %o', req.command, err);
        }
      });
    });

    this.router.textOrCallbackQuery(/\/top/, (req) => {
      // todo: fix top
    });

    let liveTime = null;
    this.router.textOrCallbackQuery(/\/about/, (req) => {
      if (!liveTime) {
        try {
          liveTime = JSON.parse(fs.readFileSync('./liveTime.json', 'utf8'));
        } catch (err) {
          debug('Read liveTime.json error! %o', err);
          liveTime = {
            endTime: '1970-01-01',
            message: [
              '{count}'
            ]
          };
        }
        if (Array.isArray(liveTime.message)) {
          liveTime.message = liveTime.message.join('\n');
        }
      }

      let count = '';
      const m = /(\d{4}).(\d{2}).(\d{2})/.exec(liveTime.endTime);
      if (m) {
        const endTime = (new Date(m[1], m[2], m[3])).getTime();
        count = Math.trunc((endTime - Date.now()) / 1000 / 60 / 60 / 24 / 30 * 10) / 10;
      }

      const message = liveTime.message.replace('{count}', count);

      return this.main.bot.sendMessage(req.chatId, message).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });
  }

  user() {
    const ensureChannels = (/**RouterReq*/req, next) => {
      this.main.db.getChannelsByChatId(req.chatId).then((channels) => {
        req.channels = channels;
        next();
      }, (err) => {
        debug('ensureChannels error! %o', err);
        this.main.bot.sendMessage(req.chatId, 'Oops something went wrong...');
      });
    };

    const ensureChat = (/**RouterReq*/req, next) => {
      this.main.db.getChatById(req.chatId).catch((err) => {
        if (err.code === 'CHAT_IS_NOT_FOUND') {
          return {id: req.chatId};
        }
        throw err;
      }).then((chat) => {
        req.chat = chat;
        next();
      }, (err) => {
        debug('ensureChat error! %o', err);
        this.main.bot.sendMessage(req.chatId, 'Oops something went wrong...');
      });
    };

    const shouldBeChannels = (req, next) => {
      if (!req.channels.length) {
        next();
      } else {
        this.main.bot.sendMessage(req.chatId, this.main.locale.getMessage('emptyServiceList'));
      }
    };

    this.router.callback_query(/\/cancel\/(?<command>[^\s]+)/, (req) => {
      const command = req.params.command;

      const cancelText = this.main.locale.getMessage('commandCanceled').replace('{command}', command);
      return this.main.bot.editMessageText(cancelText, {
        chat_id: req.chatId,
        message_id: req.messageId
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/add(?:\s+(?<query>.+$))?/, (req) => {
      const serviceId = 'youtube';
      const query = req.params.query;

      return Promise.resolve().then(() => {
        if (query) {
          return {query};
        }

        const messageText = this.main.locale.getMessage('enterChannelName');
        const cancelText = this.main.locale.getMessage('commandCanceled').replace('{command}', 'add');
        return requestData(req.chatId, req.fromId, messageText, cancelText).then(({req, msg}) => {
          this.main.tracker.track(req.chatId, 'command', '/add', req.message.text);
          return {query: req.message.text, messageId: msg.message_id};
        });
      }).then(({query, messageId}) => {
        const service = /**@type Youtube*/this.main[serviceId];
        return service.findChannel(query).then((channel) => {
          return this.main.db.addChatChannelId(req.chatId, serviceId, channel.id).then((created) => {
            return {channel, created};
          });
        }).then(({channel, created}) => {
          let message = null;
          if (!created) {
            message = this.main.locale.getMessage('channelExists');
          } else {
            const {name, url} = channel;
            message = this.main.locale.getMessage('channelAdded')
              .replace('{channelName}', htmlSanitize('a', name, url))
              .replace('{serviceName}', htmlSanitize(service.name));
          }
          return editOrSendNewMessage(req.chatId, messageId, message, {
            disable_web_page_preview: true
          });
        }, async (err) => {
          let isResolved = false;
          let message = null;
          if (err.code === 'CHANNEL_IS_NOT_FOUND') {
            isResolved = true;
            message = this.main.locale.getMessage('channelIsNotFound').replace('{channelName}', query);
          } else
          if (err.message === 'CHANNELS_LIMIT') {
            isResolved = true;
            message = 'Channels limit exceeded';
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
          debug('%j error %o', req.command, err);
        }
      });
    });

    this.router.callback_query(/\/clear\/confirmed/, (req) => {
      return this.main.db.removeChatById(req.chatId, 'By user').then(() => {
        return this.main.bot.editMessageText(this.main.locale.getMessage('cleared'), {
          chat_id: req.chatId,
          message_id: req.messageId
        });
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/clear/, (req) => {
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
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.callback_query(/\/delete\/(?<channelId>.+)/, (req) => {
      const serviceId = 'youtube';
      const channelId = req.params.channelId;

      return this.main.db.getChannelById(serviceId, channelId).then((channel) => {
        return this.main.db.removeChatChannelId(req.chatId, channelId).then((deleted) => {
          return {channel, deleted};
        });
      }).then(({channel, deleted}) => {
        return this.main.bot.editMessageText(this.main.locale.getMessage('channelDeleted').replace('{channelName}', channel.name), {
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

    this.router.textOrCallbackQuery(/\/delete/, ensureChannels, shouldBeChannels, (req) => {
      const channels = req.channels.map((channel) => {
        return [{
          text: channel.name,
          callback_data: `/delete/${channel.id}`
        }];
      });

      const page = pageBtnList(req.query, channels, '/delete', {
        text: 'Cancel',
        callback_data: '/cancel/delete'
      });

      return Promise.resolve().then(() => {
        if (req.callback_query && !req.query.rel) {
          return this.main.bot.editMessageReplyMarkup(JSON.stringify({
            inline_keyboard: page
          }), {
            chat_id: req.chatId,
            message_id: req.messageId
          }).catch((err) => {
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

    this.router.callback_query(/\/options\/(?<key>[^\/]+)\/(?<value>.+)/, ensureChat, (req) => {
      const {key, value} = req.params;
      // set key value
    });

    this.router.callback_query(/\/options\/deleteChannel/, ensureChat, (req) => {
      // rm channel
    });

    this.router.textOrCallbackQuery(/\/options\/setChannel/, ensureChat, (req) => {
      const messageText = this.main.locale.getMessage('telegramChannelEnter');
      const cancelText = this.main.locale.getMessage('commandCanceled').replace('{command}', '\/options\/setChannel');
      return requestData(req.chatId, req.fromId, messageText, cancelText).then(({req, msg}) => {
        this.main.tracker.track(req.chatId, 'command', '/options/setChannel', req.message.text);
        return {channelId: req.message.text.trim(), messageId: msg.message_id};
      }).then(({channelId, messageId}) => {
        return Promise.resolve().then(() => {
          if (!/^@\w+$/.test(channelId)) {
            throw new ErrorWithCode('Incorrect channel name', 'INCORRECT_CHANNEL_NAME');
          }

          return this.main.db.getChatByChannelId(channelId).then((chat) => {
            if (chat) {
              throw new ErrorWithCode('Channel already used', 'CHANNEL_ALREADY_USED');
            }
          }, (err) => {
            if (err.code !== 'CHAR_IS_NOT_FOUND') {
              throw err;
            }

            return this.main.bot.sendChatAction(channelId, 'typing').then(() => {
              return this.main.bot.getChat(channelId).then((result) => {
                if (result.type !== 'channel') {
                  throw new ErrorWithCode('This chat type is not supported', 'INCORRECT_CHAT_TYPE');
                }
                // chat.options.mute = false;
                // chat.channelId = channelId;
                return '@' + result.username;
              });
            });
          });
        }).then((channelId) => {
          const message = this.main.locale.getMessage('telegramChannelSet').replace('{channelName}', channelId);
          return editOrSendNewMessage(req.chatId, messageId, message).then(() => {
            if (req.callback_query) {
              this.main.bot.editMessageReplyMarkup(JSON.stringify({
                inline_keyboard: getOptions(req.chat)
              }), {
                chat_id: req.chatId,
                message_id: req.messageId
              }).catch((err) => {
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
        });
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/options/, ensureChat, (req) => {
      return Promise.resolve().then(() => {
        if (req.callback_query && !query.rel) {
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

    const requestData = (chatId, fromId, messageText, cancelText) => {
      const options = {};
      let msgText = messageText;
      if (chatId < 0) {
        msgText += this.main.locale.getMessage('groupNote');
        options.reply_markup = JSON.stringify({
          force_reply: true
        });
      }

      return this.main.bot.sendMessage(chatId, msgText, options).then((msg) => {
        return this.router.waitResponse({
          event: 'message',
          type: 'text',
          chatId: chatId,
          fromId: fromId,
          throwOnCommand: true
        }, 3 * 60).then((req) => {
          return {req, msg};
        }, async (err) => {
          if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
            await editOrSendNewMessage(chatId, msg.message_id, cancelText);
          }
          throw err;
        });
      });
    };

    const editOrSendNewMessage = (chatId, messageId, text, form) => {
      return Promise.resolve().then(() => {
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
    }
  }
}

function getMenu(page) {
  let menu = null;
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

function getOptions(chat) {
  const options = chat.options;

  const btnList = [];

  if (options.hidePreview) {
    btnList.push([{
      text: 'Show preview',
      callback_data: '/options/hidePreview/false'
    }]);
  } else {
    btnList.push([{
      text: 'Hide preview',
      callback_data: '/options/hidePreview/true'
    }]);
  }

  if (chat.channelId) {
    btnList.push([{
      text: 'Remove channel (' + chat.channelId + ')',
      callback_data: '/options/deleteChannel',
    }]);
  } else {
    btnList.push([{
      text: 'Set channel',
      callback_data: '/options/setChannel',
    }]);
  }

  if (chat.channelId) {
    if (options.mute) {
      btnList.push([{
        text: 'Unmute',
        callback_data: '/options/mute/false'
      }]);
    } else {
      btnList.push([{
        text: 'Mute',
        callback_data: '/options/mute/true'
      }]);
    }
  }

  return btnList;
}

export default Chat;