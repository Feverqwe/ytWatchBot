import Router from "./router";

const debug = require('debug')('app:Chat');
const fs = require('fs');

class Chat {
  constructor(/**Main*/main) {
    this.main = main;

    this.router = new Router(main);

    /**@type {function(RegExp, function(RouterReq, function()))}*/
    this.router.textOrCallbackQuery = this.router.custom(['text', 'callback_query']);

    this.main.bot.on('message', (message) => {
      this.router.handle('message', message);
    });
    this.main.bot.on('callback_query', (message) => {
      this.router.handle('callback_query', message);
    });

    this.base();
    this.menu();
  }

  base() {
    this.router.textOrCallbackQuery(/(.+)/, (/**RouterReq*/req, next) => {
      next();
      if (req.message) {
        const commands = req.entities.bot_command || [];
        commands.forEach((entity) => {
          let command = entity.value;
          const m = /([^@]+)/.exec(command);
          if (m) {
            command = m[1];
          }
          this.main.tracker.track(req.message.chat.id, {
            ec: 'command',
            ea: command,
            el: req.message.text,
          });
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
        debug('Command ping error! %o', err);
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
        debug('Command start error! %o', err);
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
          debug('CallbackQuery start error! %o', err);
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

      return this.main.bot.sendMessage(req.chatId, message).catch(function (err) {
        debug('Command about error! %o', err);
      });
    });
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

export default Chat;