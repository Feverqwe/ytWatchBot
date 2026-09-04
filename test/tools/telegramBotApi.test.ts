import {Readable} from 'node:stream';
import {describe, expect, jest, test} from '@jest/globals';
import {InputFile, type SendMessageParams, type SendPhotoParams} from 'node-telegram-bot-api';
import {TelegramBotWrapped} from '../../src/tools/telegramBotApi';

type MockApi = {
  sendMessage: jest.Mock<(params: SendMessageParams) => Promise<unknown>>;
  sendPhoto: jest.Mock<(params: SendPhotoParams) => Promise<unknown>>;
};

const getMockApi = (bot: TelegramBotWrapped): MockApi => {
  return (bot as unknown as {bot: {api: MockApi}}).bot.api;
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

  test('wraps Node streams in an InputFile', async () => {
    const bot = new TelegramBotWrapped('test-token');
    const api = getMockApi(bot);
    api.sendPhoto = jest.fn<(params: SendPhotoParams) => Promise<unknown>>().mockResolvedValue({});

    await bot.sendPhoto(
      1,
      Readable.from(Buffer.from('image')),
      {},
      {
        contentType: 'image/jpeg',
        filename: 'preview.jpg',
      },
    );

    const photo = api.sendPhoto.mock.calls[0][0].photo;
    expect(photo).toBeInstanceOf(InputFile);
    expect((photo as InputFile).meta).toEqual({
      contentType: 'image/jpeg',
      filename: 'preview.jpg',
    });
  });
});
