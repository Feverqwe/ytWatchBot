import {Readable} from 'node:stream';
import {describe, expect, jest, test} from '@jest/globals';
import {
  Bot,
  InputFile,
  type Context,
  type SendChatActionParams,
  type SendMessageParams,
  type SendPhotoParams,
} from 'node-telegram-bot-api';
import {TelegramBotWrapped} from '../../src/tools/telegramBotApi';

type MockApi = {
  sendChatAction: jest.Mock<(params: SendChatActionParams) => Promise<unknown>>;
  sendMessage: jest.Mock<(params: SendMessageParams) => Promise<unknown>>;
  sendPhoto: jest.Mock<(params: SendPhotoParams) => Promise<unknown>>;
};

const getMockApi = (bot: TelegramBotWrapped): MockApi => {
  return getCoreBot(bot).api as unknown as MockApi;
};

const getCoreBot = (bot: TelegramBotWrapped): Bot => {
  return (bot as unknown as {bot: Bot}).bot;
};

describe('TelegramBotWrapped', () => {
  test('forwards v2 sendMessage parameters through the rate limiter', async () => {
    const bot = new TelegramBotWrapped('test-token');
    const api = getMockApi(bot);
    api.sendMessage = jest
      .fn<(params: SendMessageParams) => Promise<unknown>>()
      .mockResolvedValue({});

    await bot.api.sendMessage({
      chat_id: 1,
      text: 'hello',
      link_preview_options: {is_disabled: true},
      reply_parameters: {message_id: 7},
      reply_markup: {force_reply: true},
    });

    expect(api.sendMessage).toHaveBeenCalledWith(
      {
        chat_id: 1,
        text: 'hello',
        link_preview_options: {is_disabled: true},
        reply_parameters: {message_id: 7},
        reply_markup: {force_reply: true},
      },
      undefined,
    );
  });

  test('forwards v2 sendChatAction parameters through its rate limiter', async () => {
    const bot = new TelegramBotWrapped('test-token');
    const api = getMockApi(bot);
    api.sendChatAction = jest
      .fn<(params: SendChatActionParams) => Promise<unknown>>()
      .mockResolvedValue(true);

    await bot.api.sendChatAction({chat_id: 1, action: 'typing'});

    expect(api.sendChatAction).toHaveBeenCalledWith({chat_id: 1, action: 'typing'}, undefined);
  });

  test('passes the v2 Context to update handlers', async () => {
    const bot = new TelegramBotWrapped('test-token');
    const handler = jest.fn<(ctx: Context) => void>();
    const message = {
      message_id: 1,
      date: 0,
      chat: {id: 1, type: 'private'},
      text: 'hello',
    };
    bot.on('message', handler);

    await getCoreBot(bot).handleUpdate({update_id: 1, message});

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].message).toBe(message);
  });

  test('forwards InputFile photos through the send limiter', async () => {
    const bot = new TelegramBotWrapped('test-token');
    const api = getMockApi(bot);
    api.sendPhoto = jest.fn<(params: SendPhotoParams) => Promise<unknown>>().mockResolvedValue({});

    const photo = new InputFile(Readable.toWeb(Readable.from(Buffer.from('image'))), {
      contentType: 'image/jpeg',
      filename: 'preview.jpg',
    });
    await bot.api.sendPhoto({chat_id: 1, photo});

    expect(api.sendPhoto).toHaveBeenCalledWith({chat_id: 1, photo}, undefined);
    expect(photo.meta).toEqual({
      contentType: 'image/jpeg',
      filename: 'preview.jpg',
    });
  });
});
