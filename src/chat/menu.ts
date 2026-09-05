import Main from '../main';
import Locale from '../shared/locale';
import Router from '../shared/router';
import {getDebug} from '../shared/tools/getDebug';
import {ErrEnum, errHandler, passEx} from '../shared/tools/passTgEx';

const debug = getDebug('app:Chat');

export default function registerMenuRoutes(main: Main, router: Router) {
  const sendMenu = (locale: Locale, chatId: number, page: number) => {
    const help = locale.m('help');
    return main.bot.api.sendMessage({
      chat_id: chatId,
      text: help,
      link_preview_options: {is_disabled: true},
      reply_markup: {
        inline_keyboard: getMenu(locale, page),
      },
    });
  };

  router.text(/\/(start|menu|help)/, async (req, res) => {
    try {
      await sendMenu(res.locale, req.chatId, 0);
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.callback_query(/\/menu(?:\/(?<page>\d+))?/, async (req, res) => {
    const {locale} = res;
    const page = parseInt(req.params.page || '0', 10);
    try {
      try {
        await passEx(
          () =>
            main.bot.api.editMessageReplyMarkup({
              reply_markup: {
                inline_keyboard: getMenu(locale, page),
              },
              chat_id: req.chatId,
              message_id: req.messageId,
            }),
          [ErrEnum.MessageNotModified],
        );
      } catch (error) {
        const err = error as Error;
        if (errHandler[ErrEnum.MessageToEditNotFound](err)) {
          await sendMenu(locale, req.chatId, page);
        } else {
          throw err;
        }
      }
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(/\/top/, async (req, res) => {
    const {locale} = res;
    const service = main.youtube;

    try {
      const [chatCount, channelCount, serviceTopChannels] = await Promise.all([
        main.db.getChatIdChannelIdChatIdCount(),
        main.db.getChatIdChannelIdChannelIdCount(),
        main.db.getChatIdChannelIdTop10ByServiceId(service.id),
      ]);

      const lines = [];

      lines.push(locale.m('users', {count: chatCount}));
      lines.push(locale.m('channels', {count: channelCount}));

      lines.push('');

      lines.push(`${service.name}:`);
      serviceTopChannels.forEach(({title, chatCount}, index) => {
        lines.push(chatCount + ' - ' + title);
      });

      await main.bot.api.sendMessage({
        chat_id: req.chatId,
        text: lines.join('\n'),
        link_preview_options: {is_disabled: true},
      });
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(/\/about/, async (req, res) => {
    const {locale} = res;
    try {
      await main.bot.api.sendMessage({
        chat_id: req.chatId,
        text: locale.m('about'),
      });
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });
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
