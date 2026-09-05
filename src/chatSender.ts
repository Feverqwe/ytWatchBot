import htmlSanitize from './shared/tools/htmlSanitize';
import ErrorWithCode from './shared/tools/errorWithCode';
import inlineInspect from './tools/inlineInspect';
import fetchRequest from './tools/fetchRequest';
import Main from './main';
import {ChatModel, VideoModelWithChannel} from './db';
import {tracker} from './tracker';
import {InputFile, TelegramApiError, type Message} from 'node-telegram-bot-api';
import {getDebug} from './shared/tools/getDebug';
import {ErrEnum, errHandler} from './shared/tools/passTgEx';
import promiseTry from './shared/tools/promiseTry';
import {Readable} from 'node:stream';

const debug = getDebug('app:ChatSender');

const videoWeakMap = new WeakMap();

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
          if (err instanceof TelegramApiError) {
            const isBlocked = isBlockedError(err);
            const isSkipMessage = isSkipMessageError(err);
            if (isSkipMessage) {
              debug('skip message %s error: %o', this.chat.id, err);
              return await this.main.db.deleteChatIdVideoId(this.chat.id, video.id);
            } else if (isBlocked) {
              await this.main.db.deleteChatById(this.chat.id);
              this.main.chat.log.write(
                `[deleted] ${this.chat.id}, cause: (${err.errorCode}) ${JSON.stringify(
                  err.description,
                )}`,
              );
              throw new ErrorWithCode(`Chat ${this.chat.id} is deleted`, 'CHAT_IS_DELETED');
            } else if (err.migrateToChatId) {
              const newChatId = err.migrateToChatId;
              try {
                await this.main.db.changeChatId(this.chat.id, '' + newChatId);
              } catch (error) {
                const err = error as ErrorWithCode;
                if (/would lead to a duplicate entry in table/.test(err.message)) {
                  await this.main.db.deleteChatById(this.chat.id);
                  this.main.chat.log.write(
                    `[deleted] ${this.chat.id}, cause: ${inlineInspect(err)}`,
                  );
                  throw new ErrorWithCode(`Chat ${this.chat.id} is deleted`, 'CHAT_IS_DELETED');
                }
                throw err;
              }

              this.main.chat.log.write(`[migrate] ${this.chat.id} > ${newChatId}`);
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

    this.main.sender.log.write(`[${type}] ${this.chat.id} ${video.channelId} ${video.id}`);

    return {message};
  }

  async sendVideoAsPhoto(video: VideoModelWithChannel): Promise<{message: Message}> {
    if (video.telegramPreviewFileId) {
      try {
        const message = await this.main.bot.api.sendPhoto({
          chat_id: this.chat.id,
          photo: video.telegramPreviewFileId,
          caption: getCaption(video),
        });

        tracker.track(this.chat.id, {
          ec: 'bot',
          ea: 'sendPhoto',
          el: video.channelId,
          t: 'event',
        });

        this.main.sender.log.write(
          `[send photo as id] ${this.chat.id} ${video.channelId} ${video.id}`,
        );

        return {message};
      } catch (error) {
        const err = error;
        if (err instanceof TelegramApiError) {
          if (/FILE_REFERENCE_.+/.test(err.description)) {
            video.telegramPreviewFileId = null;

            return this.sendVideoAsPhoto(video);
          }
        }
        throw err;
      }
    } else {
      return this.requestAndSendPhoto(video);
    }
  }

  requestAndSendPhoto(video: VideoModelWithChannel) {
    let promise = videoWeakMap.get(video);

    if (!promise) {
      promise = this.ensureTelegramPreviewFileId(video).finally(() => {
        videoWeakMap.delete(video);
      });
      videoWeakMap.set(video, promise);
      promise = promise.catch((err: Error & any) => {
        if (errHandler[ErrEnum.NotEnoughRightsSendPhotos](err)) {
          throw err;
        }
        return this.sendVideoAsText(video, true).then((result) => {
          debug('ensureTelegramPreviewFileId %s error: %o', this.chat.id, err);
          return result;
        });
      });
    } else {
      promise = promise.then(
        () => {
          return this.sendVideoAsPhoto(video);
        },
        (err: Error & any) => {
          if (['INVALID_PREVIEWS', 'FILE_ID_IS_NOT_FOUND'].includes(err.code)) {
            return this.sendVideoAsText(video, true);
          } else {
            return this.sendVideoAsPhoto(video);
          }
        },
      );
    }

    return promise;
  }

  async ensureTelegramPreviewFileId(video: VideoModelWithChannel) {
    const previews = !Array.isArray(video.previews) ? JSON.parse(video.previews) : video.previews;

    const {url, contentType: contentTypeLocal} = await getValidPreviewUrl(previews);
    let contentType = contentTypeLocal;
    const caption = getCaption(video);

    const message = await promiseTry(async () => {
      try {
        const message = await this.main.bot.api.sendPhoto({
          chat_id: this.chat.id,
          photo: url,
          caption,
        });

        this.main.sender.log.write(
          `[send photo as url] ${this.chat.id} ${video.channelId} ${video.id}`,
        );

        tracker.track(this.chat.id, {
          ec: 'bot',
          ea: 'sendPhoto',
          el: video.channelId,
          t: 'event',
        });

        return message;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        let isSendUrlError = sendUrlErrors.some((re) => re.test(errorMessage));
        if (!isSendUrlError && error instanceof TelegramApiError) {
          isSendUrlError = error.errorCode === 504;
        }

        if (isSendUrlError) {
          if (!contentType) {
            debug('Content-type is empty, set default content-type %s', url);
            contentType = 'image/jpeg';
          }

          const response = await fetchRequest<NodeJS.ReadableStream>(url, {
            responseType: 'stream',
            keepAlive: true,
          });

          const message = await this.main.bot.api.sendPhoto({
            chat_id: this.chat.id,
            photo: new InputFile(Readable.toWeb(response.body as Readable), {
              contentType,
              filename: '-',
            }),
            caption,
          });

          this.main.sender.log.write(
            `[send photo as file] ${this.chat.id} ${video.channelId} ${video.id}`,
          );

          tracker.track(this.chat.id, {
            ec: 'bot',
            ea: 'sendPhoto',
            el: video.channelId,
            t: 'event',
          });

          return message;
        }

        throw error;
      }
    });

    const fileId = getPhotoFileIdFromMessage(message);
    if (!fileId) {
      throw new ErrorWithCode('File id if not found', 'FILE_ID_IS_NOT_FOUND');
    }
    video.telegramPreviewFileId = fileId;
    await video.save();

    return {message};
  }
}

const blockedErrors = [
  /group chat was deactivated/,
  /group chat is deactivated/,
  /chat not found/,
  /channel not found/,
  /USER_DEACTIVATED/,
  /have no rights to send a message/,
  /need administrator rights in the channel chat/,
  /CHAT_WRITE_FORBIDDEN/,
  /CHAT_SEND_MEDIA_FORBIDDEN/,
  /CHAT_RESTRICTED/,
  /not enough rights to send text messages to the chat/,
];

const skipMsgErrors = [/TOPIC_DELETED/, /TOPIC_CLOSED/];

const sendUrlErrors = [
  /failed to get HTTP URL content/,
  /wrong type of the web page content/,
  /wrong file identifier\/HTTP URL specified/,
  /FILE_REFERENCE_.+/,
];

function getPhotoFileIdFromMessage(message: Message): string | null {
  let fileId = null;
  message.photo
    ?.slice(0)
    .sort((a, b) => {
      return a.file_size! > b.file_size! ? -1 : 1;
    })
    .some((item) => (fileId = item.file_id));
  return fileId;
}

async function getValidPreviewUrl(urls: string[]) {
  let lastError = null;
  for (let i = 0, len = urls.length; i < len; i++) {
    try {
      const {url, headers} = await fetchRequest(urls[i], {
        method: 'HEAD',
        timeout: 5 * 1000,
        keepAlive: true,
      });
      const contentType = headers['content-type'] as string;
      return {url, contentType};
    } catch (err) {
      lastError = err;
    }
  }
  const err = new ErrorWithCode(`Previews is invalid`, 'INVALID_PREVIEWS');
  Object.assign(err, {original: lastError});
  throw err;
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

export function isBlockedError(err: unknown): boolean {
  return (
    err instanceof TelegramApiError &&
    (err.errorCode === 403 || blockedErrors.some((re) => re.test(err.description)))
  );
}

export function isSkipMessageError(err: unknown): boolean {
  return err instanceof TelegramApiError && skipMsgErrors.some((re) => re.test(err.description));
}

export default ChatSender;
