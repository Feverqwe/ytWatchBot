import htmlSanitize from './shared/tools/htmlSanitize';
import ErrorWithCode from './shared/tools/errorWithCode';
import inlineInspect from './tools/inlineInspect';
import fetchRequest from './tools/fetchRequest';
import Main from './main';
import {ChatModel, VideoModelWithChannel} from './db';
import {tracker} from './tracker';
import {type Message} from 'node-telegram-bot-api';
import {getDebug} from './shared/tools/getDebug';
import {
  ErrEnum,
  errHandler,
  getTelegramErrorBody,
  isBlockedError,
  isSkipMessageError,
} from './shared/tools/passTgEx';
import {coordinatePreviewRequest, sendPreviewPhoto} from './shared/tools/telegramPreview';

const debug = getDebug('app:ChatSender');

class ChatSender {
  aborted = false;
  lockCount = 0;
  startAt = Date.now();
  lastActivityAt = Date.now();

  private videoIds: null | string[] = null;

  constructor(
    private main: Main,
    public chat: ChatModel,
  ) {}

  getVideoIds() {
    return this.main.db.getVideoIdsByChatId(this.chat.id, 10);
  }

  async next() {
    this.lastActivityAt = Date.now();

    if (!this.videoIds || !this.videoIds.length) {
      this.videoIds = await this.getVideoIds();
    }

    const videoId = this.videoIds.shift();
    if (!videoId) {
      return true;
    }

    try {
      await this.main.sender.provideVideo(videoId, async (video) => {
        try {
          const previews = !Array.isArray(video.previews)
            ? JSON.parse(video.previews)
            : video.previews;

          if (this.chat.isHidePreview || !previews.length) {
            await this.sendVideoAsText(video);
          } else {
            await this.sendVideoAsPhoto(video);
          }

          await this.main.db.deleteChatIdVideoId(this.chat.id, video.id);
        } catch (error) {
          const err = error;
          const body = getTelegramErrorBody(err);
          if (body) {
            if (isSkipMessageError(err)) {
              debug('skip message %s error: %o', this.chat.id, err);
              return await this.main.db.deleteChatIdVideoId(this.chat.id, video.id);
            } else if (isBlockedError(err)) {
              await this.main.db.deleteChatById(this.chat.id);
              this.main.logs.chat.write(
                `[deleted] ${this.chat.id}, cause: (${body.error_code}) ${JSON.stringify(
                  body.description,
                )}`,
              );
              throw new ErrorWithCode(`Chat ${this.chat.id} is deleted`, 'CHAT_IS_DELETED');
            } else if (body.parameters?.migrate_to_chat_id) {
              const newChatId = body.parameters.migrate_to_chat_id;
              try {
                await this.main.db.changeChatId(this.chat.id, '' + newChatId);
              } catch (error) {
                const err = error as ErrorWithCode;
                if (/would lead to a duplicate entry in table/.test(err.message)) {
                  await this.main.db.deleteChatById(this.chat.id);
                  this.main.logs.chat.write(
                    `[deleted] ${this.chat.id}, cause: ${inlineInspect(err)}`,
                  );
                  throw new ErrorWithCode(`Chat ${this.chat.id} is deleted`, 'CHAT_IS_DELETED');
                }
                throw err;
              }

              this.main.logs.chat.write(`[migrate] ${this.chat.id} > ${newChatId}`);
              throw new ErrorWithCode(
                `Chat ${this.chat.id} is migrated to ${newChatId}`,
                'CHAT_IS_MIGRATED',
              );
            } else if (errHandler[ErrEnum.NotEnoughRightsSendPhotos](err)) {
              this.chat.isHidePreview = true;

              await this.chat.save();
              throw new ErrorWithCode(`Chat ${this.chat.id} is deny photos`, 'CHAT_IS_DENY_PHOTOS');
            }
          }

          throw err;
        }
      });
    } catch (error) {
      const err = error as ErrorWithCode;
      if (err.code === 'VIDEO_IS_NOT_FOUND') {
        // pass
      } else {
        throw err;
      }
    }
  }

  async sendVideoAsText(video: VideoModelWithChannel, isFallback = false) {
    const message = await this.main.bot.api.sendMessage({
      chat_id: this.chat.id,
      text: getDescription(video),
      parse_mode: 'HTML',
    });

    let type;
    if (isFallback) {
      type = 'send message as fallback';
    } else {
      type = 'send message';
    }

    tracker.track(this.chat.id, {
      ec: 'bot',
      ea: 'sendMsg',
      el: video.channelId,
      t: 'event',
    });

    this.main.logs.sender.write(`[${type}] ${this.chat.id} ${video.channelId} ${video.id}`);

    return {message};
  }

  async sendVideoAsPhoto(video: VideoModelWithChannel): Promise<{message: Message}> {
    if (video.telegramPreviewFileId) {
      return this.ensureTelegramPreviewFileId(video);
    } else {
      return this.requestAndSendPhoto(video);
    }
  }

  requestAndSendPhoto(video: VideoModelWithChannel): Promise<{message: Message}> {
    return coordinatePreviewRequest(
      video,
      () => this.ensureTelegramPreviewFileId(video),
      (error) => {
        const err = error as ErrorWithCode;
        if (errHandler[ErrEnum.NotEnoughRightsSendPhotos](err)) {
          throw err;
        }
        return this.sendVideoAsText(video, true).then((result) => {
          debug('ensureTelegramPreviewFileId %s error: %o', this.chat.id, err);
          return result;
        });
      },
      (error) => {
        const err = error as ErrorWithCode;
        if (['INVALID_PREVIEWS', 'FILE_ID_IS_NOT_FOUND'].includes(err.code)) {
          return this.sendVideoAsText(video, true);
        }
        return this.sendVideoAsPhoto(video);
      },
    );
  }

  async ensureTelegramPreviewFileId(video: VideoModelWithChannel): Promise<{message: Message}> {
    const previews = !Array.isArray(video.previews) ? JSON.parse(video.previews) : video.previews;
    const caption = getCaption(video);
    const result = await sendPreviewPhoto({
      api: this.main.bot.api,
      chatId: this.chat.id,
      caption,
      previewUrls: previews,
      cachedFileId: video.telegramPreviewFileId,
      head: async (url) => {
        const response = await fetchRequest(url, {
          method: 'HEAD',
          timeout: 5 * 1000,
          keepAlive: true,
        });
        return {url: response.url, contentType: response.headers['content-type'] as string};
      },
      download: async (url) => {
        const response = await fetchRequest<NodeJS.ReadableStream>(url, {
          responseType: 'stream',
          keepAlive: true,
        });
        return {body: response.body};
      },
      onCachedFileIdInvalid: () => {
        video.telegramPreviewFileId = null;
      },
      onSent: (source) => {
        this.main.logs.sender.write(
          `[send photo as ${source}] ${this.chat.id} ${video.channelId} ${video.id}`,
        );
        tracker.track(this.chat.id, {
          ec: 'bot',
          ea: 'sendPhoto',
          el: video.channelId,
          t: 'event',
        });
      },
    });

    if (video.telegramPreviewFileId !== result.fileId) {
      video.telegramPreviewFileId = result.fileId;
      await video.save();
    }

    return {message: result.message};
  }
}

function getDescription(video: VideoModelWithChannel) {
  const lines = [];

  const firstLine = [htmlSanitize('', video.title), '—', htmlSanitize('', video.channel.title)];

  const secondLine = [video.url];
  if (video.duration) {
    secondLine.push(video.duration);
  }

  lines.push(firstLine.join(' '));
  lines.push(secondLine.join(' '));

  return lines.join('\n');
}

function getCaption(video: VideoModelWithChannel) {
  const lines = [];

  const firstLine = [video.title, '—', video.channel.title];

  const secondLine = [video.url];
  if (video.duration) {
    secondLine.push(video.duration);
  }

  lines.push(firstLine.join(' '));
  lines.push(secondLine.join(' '));

  return lines.join('\n');
}

export default ChatSender;
