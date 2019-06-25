import htmlSanitize from "./tools/htmlSanitize";
import promiseFinally from "./tools/promiseFinally";
import ErrorWithCode from "./tools/errorWithCode";

const debug = require('debug')('app:ChatSender');
const got = require('got');

const videoWeakMap = new WeakMap();

class ChatSender {
  constructor(/**Main*/main, chat) {
    this.main = main;
    this.chat = chat;

    this.videoIds = null;
  }

  offset = 0;
  getVideoIds() {
    const prevOffset = this.offset;
    this.offset += 10;
    return this.main.db.getVideoIdsByChatId(this.chat.id, 10, prevOffset);
  }

  async next() {
    if (!this.videoIds || !this.videoIds.length) {
      this.videoIds = await this.getVideoIds();
    }

    if (!this.videoIds.length) {
      return true;
    }

    return this.main.sender.provideVideo(this.videoIds.shift(), (video) => {
      return Promise.resolve().then(() => {
        if (this.chat.isHidePreview || !video.previews.length) {
          return this.sendVideoAsText(video);
        } else {
          return this.sendVideoAsPhoto(video);
        }
      }).catch((err) => {
        if (err.code === 'ETELEGRAM') {
          const body = err.response.body;

          let isBlocked = body.error_code === 403;
          if (!isBlocked) {
            isBlocked = blockedErrors.some(re => re.test(body.description));
          }

          if (isBlocked) {
            return this.main.db.deleteChatById(this.chat.id).then(() => {
              debug('Chat %s deleted, cause: (%s) %s', this.chat.id, body.error_code, body.description);
              throw new ErrorWithCode(`Chat ${this.chat.id} is deleted`, 'CHAT_IS_DELETED');
            });
          } else
          if (body.parameters && body.parameters.migrate_to_chat_id) {
            const newChatId = body.parameters.migrate_to_chat_id;
            return this.main.db.changeChatId(this.chat.id, newChatId).then(() => {
              debug('Chat %s migrated to %s', this.chat.id, newChatId);
              throw new ErrorWithCode(`Chat ${this.chat.id} is migrated to ${newChatId}`, 'CHAT_IS_MIGRATED');
            });
          }
        }

        throw err;
      }).then(() => {
        return this.main.db.deleteChatIdVideoId(this.chat.id, video.id);
      });
    }).catch((err) => {
      if (err.code === 'VIDEO_IS_NOT_FOUND') {
        // pass
      } else {
        throw err;
      }
    }).then(() => {});
  }

  sendVideoAsText(video) {
    return this.main.bot.sendMessage(this.chat.id, getDescription(video), {
      parse_mode: 'HTML'
    });
  }

  sendVideoAsPhoto(video) {
    if (video.telegramPreviewFileId) {
      return this.main.bot.sendPhotoQuote(this.chat.id, video.telegramPreviewFileId, {
        caption: getCaption(video)
      });
    } else {
      return this.requestAndSendPhoto(video);
    }
  }

  requestAndSendPhoto(video) {
    let promise = videoWeakMap.get(video);

    if (!promise) {
      promise = this.ensureTelegramPreviewFileId(video).then(...promiseFinally(() => {
        videoWeakMap.delete(video);
      }));
      videoWeakMap.set(video, promise);
      promise = promise.catch((err) => {
        if (err.code === 'ETELEGRAM' && /not enough rights to send photos/.test(err.response.body.description)) {
          throw err;
        }
        return this.sendVideoAsText(video).then((result) => {
          debug('ensureTelegramPreviewFileId %s error: %o', this.chat.id, err);
          return result;
        });
      });
    } else {
      promise = promise.then(() => {
        return this.sendVideoAsPhoto(video);
      }, (err) => {
        if (['INVALID_PREVIEWS', 'FILE_ID_IS_NOT_FOUND'].includes(err.code)) {
          return this.sendVideoAsText(video);
        } else {
          return this.sendVideoAsPhoto(video);
        }
      });
    }

    return promise;
  }

  ensureTelegramPreviewFileId(video) {
    const previews = JSON.parse(video.previews);
    return getValidPreviewUrl(previews).then(({url, contentType}) => {
      const caption = getCaption(video);
      return this.main.bot.sendPhoto(this.chat.id, url, {caption}).catch((err) => {
        let isSendUrlError = sendUrlErrors.some(re => re.test(err.message));
        if (!isSendUrlError) {
          isSendUrlError = err.response && err.response.statusCode === 504;
        }

        if (isSendUrlError) {
          if (!contentType) {
            debug('Content-type is empty, set default content-type', url);
            contentType = 'image/jpeg';
          }
          return this.main.bot.sendPhoto(this.chat.id, got.stream(url), {caption}, {contentType});
        }

        throw err;
      });
    }).then((response) => {
      const fileId = getPhotoFileIdFromMessage(response);
      if (!fileId) {
        throw new ErrorWithCode('FILE_ID_IS_NOT_FOUND');
      }
      video.telegramPreviewFileId = fileId;
      return video.save();
    });
  }
}

const blockedErrors = [
  /group chat is deactivated/,
  /chat not found/,
  /channel not found/,
  /USER_DEACTIVATED/,
  /not enough rights to send photos to the chat/,
  /have no rights to send a message/,
  /need administrator rights in the channel chat/,
  /CHAT_WRITE_FORBIDDEN/,
  /CHAT_SEND_MEDIA_FORBIDDEN/
];

const sendUrlErrors = [
  /failed to get HTTP URL content/,
  /wrong type of the web page content/,
  /wrong file identifier\/HTTP URL specified/
];

function getPhotoFileIdFromMessage(response) {
  let fileId = null;
  response.photo.slice(0).sort((a, b) => {
    return a.file_size > b.file_size ? -1 : 1;
  }).some(item => fileId = item.file_id);
  return fileId;
}

async function getValidPreviewUrl(urls) {
  let lastError = null;
  for (let i = 0, len = urls.length; i < len; i++) {
    try {
      return await got.head(urls[i], {timeout: 5 * 1000}).then(response => {
        const url = response.url;
        const contentType = response.headers['content-type'];
        return {url, contentType};
      });
    } catch (err) {
      lastError = err;
    }
  }
  debug('getValidPreviewUrl error %o', lastError);
  throw new ErrorWithCode(`Previews is invalid`, 'INVALID_PREVIEWS');
}

function getDescription(video) {
  const lines = [];

  const firstLine = [
    htmlSanitize(video.title), '—', htmlSanitize(video.channel.name)
  ];

  const secondLine = [video.url];
  if (video.duration) {
    secondLine.push(video.duration);
  }

  lines.push(firstLine.join(' '));
  lines.push(secondLine.join(' '));

  return lines.join('\n');
}

function getCaption(video) {
  const lines = [];

  const firstLine = [
    video.title, '—', video.channel.name
  ];

  const secondLine = [video.url];
  if (video.duration) {
    secondLine.push(video.duration);
  }

  lines.push(firstLine.join(' '));
  lines.push(secondLine.join(' '));

  return lines.join('\n');
}

export default ChatSender;