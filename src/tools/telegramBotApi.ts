import {Bot, type Api} from 'node-telegram-bot-api';
import RateLimit2 from './rateLimit2';
import {getDebug} from './getDebug';

const debug = getDebug('app:telegramBotApi');

export function applyTelegramRateLimits(api: Api): void {
  const sendLimit = new RateLimit2(30);
  const chatActionLimit = new RateLimit2(30);
  const sendChatAction = api.sendChatAction.bind(api);
  const sendMessage = api.sendMessage.bind(api);
  const sendPhoto = api.sendPhoto.bind(api);

  api.sendChatAction = (params, signal) =>
    chatActionLimit.run(() => sendChatAction(params, signal));
  api.sendMessage = (params, signal) => sendLimit.run(() => sendMessage(params, signal));
  api.sendPhoto = (params, signal) => sendLimit.run(() => sendPhoto(params, signal));
}

export const getTelegramBot = (token: string): Bot => {
  const bot = new Bot(token);
  applyTelegramRateLimits(bot.api);
  bot.catch((err) => {
    debug('handler error %o', err);
  });
  return bot;
};
