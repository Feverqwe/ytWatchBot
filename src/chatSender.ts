import htmlSanitize from "./tools/htmlSanitize";
import ErrorWithCode from "./tools/errorWithCode";
import promiseTry from "./tools/promiseTry";
import inlineInspect from "./tools/inlineInspect";
import fetchRequest from "./tools/fetchRequest";
import Main from "./main";
import {TMessage} from "./router";
import {ChatModel, VideoModelWithChannel} from "./db";

const debug = require('debug')('app:ChatSender');

const videoWeakMap = new WeakMap();

class ChatSender {
  aborted = false;
  lockCount = 0;
  startAt = Date.now();
  lastActivityAt = Date.now();

  private videoIds: null | string[] = null;

  constructor(private main: Main, public chat: ChatModel) {}

  getVideoIds() {
    return this.main.db.getVideoIdsByChatId(this.chat.id, 10);
  }

  async next() {
    this.lastActivityAt = Date.now();

    if (!this.videoIds || !this.videoIds.length) {
      this.videoIds = await this.getVideoIds();
    }

    if (!this.videoIds.length) {
      return true;
    }

    return this.main.sender.provideVideo(this.videoIds.shift()!, (video) => {
      return promiseTry(() => {
        if (this.chat.isHidePreview || !video.previews.length) {
          return this.sendVideoAsText(video);
        } else {
          return this.sendVideoAsPhoto(video);
        }
      }).then((sendMessage) => {
        return this.main.db.deleteChatIdVideoId(this.chat.id, video.id);
      }).catch((err) => {
        if (err.code === 'ETELEGRAM') {
          const body = err.response.body;

          const isBlocked = isBlockedError(err);
          const isSkipMessage = isSkipMessageError(err);
          if (isSkipMessage) {
            debug('skip message %s error: %o', this.chat.id, err);
            return this.main.db.deleteChatIdVideoId(this.chat.id, video.id);
          } else
          if (isBlocked) {
            return this.main.db.deleteChatById(this.chat.id).then(() => {
              this.main.chat.log.write(`[deleted] ${this.chat.id}, cause: (${body.error_code}) ${JSON.stringify(body.description)}`);
              throw new ErrorWithCode(`Chat ${this.chat.id} is deleted`, 'CHAT_IS_DELETED');
            });
          } else
          if (body.parameters && body.parameters.migrate_to_chat_id) {
            const newChatId = body.parameters.migrate_to_chat_id;
            return this.main.db.changeChatId(this.chat.id, '' + newChatId).then(() => {
              this.main.chat.log.write(`[migrate] ${this.chat.id} > ${newChatId}`);
              throw new ErrorWithCode(`Chat ${this.chat.id} is migrated to ${newChatId}`, 'CHAT_IS_MIGRATED');
            }, async (err: Error & any) => {
              if (/would lead to a duplicate entry in table/.test(err.message)) {
                await this.main.db.deleteChatById(this.chat.id);
                this.main.chat.log.write(`[deleted] ${this.chat.id}, cause: ${inlineInspect(err)}`);
                throw new ErrorWithCode(`Chat ${this.chat.id} is deleted`, 'CHAT_IS_DELETED');
              }
              throw err;
            });
          } else
          if (/not enough rights to send photos/.test(body.description)) {
            this.chat.isHidePreview = true;

            return this.chat.save().then(() => {
              throw new ErrorWithCode(`Chat ${this.chat.id} is deny photos`, 'CHAT_IS_DENY_PHOTOS');
            });
          }
        }

        throw err;
      });
    }).catch((err) => {
      if (err.code === 'VIDEO_IS_NOT_FOUND') {
        // pass
      } else {
        throw err;
      }
    }).then(() => {});
  }

  sendVideoAsText(video: VideoModelWithChannel, isFallback = false): Promise<{message: TMessage}> {
    return this.main.bot.sendMessage(this.chat.id, getDescription(video), {
      parse_mode: 'HTML'
    }).then((message: TMessage) => {
      let type = null;
      if (isFallback) {
        type = 'send message as fallback';
      } else {
        type = 'send message';
      }
      this.main.tracker.track(this.chat.id, {
        ec: 'bot',
        ea: 'sendMsg',
        el: video.channelId,
        t: 'event'
      });
      this.main.sender.log.write(`[${type}] ${this.chat.id} ${video.channelId} ${video.id}`);
      return {message};
    });
  }

  sendVideoAsPhoto(video: VideoModelWithChannel) {
    if (video.telegramPreviewFileId) {
      return this.main.bot.sendPhotoQuote(this.chat.id, video.telegramPreviewFileId, {
        caption: getCaption(video)
      }).then((message: TMessage) => {
        this.main.tracker.track(this.chat.id, {
          ec: 'bot',
          ea: 'sendPhoto',
          el: video.channelId,
          t: 'event'
        });
        this.main.sender.log.write(`[send photo as id] ${this.chat.id} ${video.channelId} ${video.id}`);
        return {message};
      }, (err: Error & any) => {
        if (err.code === 'ETELEGRAM') {
          const body = err.response.body;

          if (/FILE_REFERENCE_.+/.test(body.description)) {
            video.telegramPreviewFileId = null;

            return this.sendVideoAsPhoto(video);
          }
        }
        throw err;
      });
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
        if (err.code === 'ETELEGRAM' && /not enough rights to send photos/.test(err.response.body.description)) {
          throw err;
        }
        return this.sendVideoAsText(video, true).then((result) => {
          debug('ensureTelegramPreviewFileId %s error: %o', this.chat.id, err);
          return result;
        });
      });
    } else {
      promise = promise.then(() => {
        return this.sendVideoAsPhoto(video);
      }, (err: Error & any) => {
        if (['INVALID_PREVIEWS', 'FILE_ID_IS_NOT_FOUND'].includes(err.code)) {
          return this.sendVideoAsText(video, true);
        } else {
          return this.sendVideoAsPhoto(video);
        }
      });
    }

    return promise;
  }

  ensureTelegramPreviewFileId(video: VideoModelWithChannel) {
    const previews = !Array.isArray(video.previews) ? JSON.parse(video.previews) : video.previews;
    return getValidPreviewUrl(previews).then(({url, contentType}) => {
      const caption = getCaption(video);
      return this.main.bot.sendPhoto(this.chat.id, url, {caption}).then((message: TMessage) => {
        this.main.sender.log.write(`[send photo as url] ${this.chat.id} ${video.channelId} ${video.id}`);
        this.main.tracker.track(this.chat.id, {
          ec: 'bot',
          ea: 'sendPhoto',
          el: video.channelId,
          t: 'event'
        });
        return message;
      }).catch((err: Error & any) => {
        let isSendUrlError = sendUrlErrors.some(re => re.test(err.message));
        if (!isSendUrlError) {
          isSendUrlError = err.response && err.response.statusCode === 504;
        }

        if (isSendUrlError) {
          if (!contentType) {
            debug('Content-type is empty, set default content-type %s', url);
            contentType = 'image/jpeg';
          }
          return fetchRequest<ReadableStream>(url, {responseType: 'stream', keepAlive: true}).then((response) => {
            return this.main.bot.sendPhoto(this.chat.id, response.body, {caption}, {contentType, filename: '-'});
          }).then((message: TMessage) => {
            this.main.sender.log.write(`[send photo as file] ${this.chat.id} ${video.channelId} ${video.id}`);
            this.main.tracker.track(this.chat.id, {
              ec: 'bot',
              ea: 'sendPhoto',
              el: video.channelId,
              t: 'event'
            });
            return message;
          });
        }

        throw err;
      });
    }).then((message) => {
      const fileId = getPhotoFileIdFromMessage(message);
      if (!fileId) {
        throw new ErrorWithCode('File id if not found', 'FILE_ID_IS_NOT_FOUND');
      }
      video.telegramPreviewFileId = fileId;
      return video.save().then(() => {
        return {message};
      });
    });
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

const skipMsgErrors = [
  /TOPIC_DELETED/,
  /TOPIC_CLOSED/,
];

const sendUrlErrors = [
  /failed to get HTTP URL content/,
  /wrong type of the web page content/,
  /wrong file identifier\/HTTP URL specified/,
  /FILE_REFERENCE_.+/,
];

function getPhotoFileIdFromMessage(message: TMessage): string|null {
  let fileId = null;
  message.photo!.slice(0).sort((a, b) => {
    return a.file_size! > b.file_size! ? -1 : 1;
  }).some(item => fileId = item.file_id);
  return fileId;
}

async function getValidPreviewUrl(urls: string[]) {
  let lastError = null;
  for (let i = 0, len = urls.length; i < len; i++) {
    try {
      return await fetchRequest(urls[i], {
        method: 'HEAD',
        timeout: 5 * 1000,
        keepAlive: true,
      }).then((response) => {
        const url = response.url;
        const contentType = response.headers['content-type'] as string;
        return {url, contentType};
      });
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

  const firstLine = [
    htmlSanitize('', video.title), '—', htmlSanitize('', video.channel.title)
  ];

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

  const firstLine = [
    video.title, '—', video.channel.title
  ];

  const secondLine = [video.url];
  if (video.duration) {
    secondLine.push(video.duration);
  }

  lines.push(firstLine.join(' '));
  lines.push(secondLine.join(' '));

  return lines.join('\n');
}

export function isBlockedError(err: any) {
  if (err.code === 'ETELEGRAM') {
    const body = err.response.body;

    let isBlocked = body.error_code === 403;
    if (!isBlocked) {
      isBlocked = blockedErrors.some(re => re.test(body.description));
    }

    return isBlocked;
  }
  return false;
}

export function isSkipMessageError(err: any) {
  if (err.code === 'ETELEGRAM') {
    const body = err.response.body;

    return skipMsgErrors.some(re => re.test(body.description));
  }
  return false;
}

export default ChatSender;