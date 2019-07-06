import getProvider from "./tools/getProvider";
import ChatSender, {isBlockedError} from "./chatSender";
import LogFile from "./logFile";
import roundStartInterval from "./tools/roundStartInterval";
import parallel from "./tools/parallel";

const debug = require('debug')('app:Sender');
const promiseLimit = require('promise-limit');
const throttle = require('lodash.throttle');

const oneLimit = promiseLimit(1);

class Sender {
  constructor(/**Main*/main) {
    this.main = main;
    this.log = new LogFile('sender');
  }

  init() {
    this.startCheckInterval();
  }

  checkIntervalId = null;
  startCheckInterval() {
    clearInterval(this.checkIntervalId);
    this.checkIntervalId = roundStartInterval(() => {
      this.checkIntervalId = setInterval(() => {
        this.check();
      }, this.main.config.emitSendMessagesEveryMinutes * 60 * 1000);
      this.check();
    });
  }

  check = () => {
    return this.main.db.getDistinctChatIdVideoIdChatIds().then((chatIds) => {
      const newChatIds = chatIds.filter(chatId => !this.chatIdChatSender.has(chatId));
      return this.main.db.setChatSendTimeoutExpiresAt(newChatIds).then(() => {
        return this.main.db.getChatsByIds(newChatIds).then((chats) => {
          chats.forEach((chat) => {
            const chatSender = new ChatSender(this.main, chat);
            this.chatIdChatSender.set(chat.id, chatSender);
            this.suspended.push(chatSender);
          });

          this.run();

          return {addedCount: chats.length};
        });
      });
    });
  };
  checkThrottled = throttle(this.check, 1000, {
    leading: false
  });

  chatIdChatSender = new Map();
  suspended = [];
  threads = [];

  run() {
    return oneLimit(() => {
      return new Promise(((resolve, reject) => {
        const {chatIdChatSender, suspended, threads} = this;
        const threadLimit = 10;

        return fillThreads();

        function fillThreads() {
          for (let i = 0; i < threadLimit; i++) {
            runThread();
          }
        }

        function runThread() {
          if (!suspended.length && !threads.length) return resolve();
          if (!suspended.length || threads.length === threadLimit) return;

          const chatSender = suspended.shift();
          threads.push(chatSender);

          return chatSender.next().then((isDone) => {
            onFinish(chatSender, isDone);
          }, (err) => {
            debug('chatSender %s stopped, cause: %o', chatSender.chat.id, err);
            onFinish(chatSender, true);
          });
        }

        function onFinish(chatSender, isDone) {
          const pos = threads.indexOf(chatSender);
          if (pos !== -1) {
            threads.splice(pos, 1);
          }
          if (isDone) {
            chatIdChatSender.delete(chatSender.chat.id);
          } else {
            suspended.push(chatSender);
          }
          fillThreads();
        }
      }));
    });
  }

  provideVideo = getProvider((id) => {
    return this.main.db.getVideoWithChannelById(id);
  }, 100);

  async checkChatsExists() {
    let offset = 0;
    let limit = 10;
    const result = {
      checkCount: 0,
      removedCount: 0,
      errorCount: 0,
    };
    while (true) {
      const chatIds = await this.main.db.getChatIds(offset, limit);
      offset += limit;
      if (!chatIds.length) break;

      await parallel(10, chatIds, (chatId) => {
        result.checkCount++;
        return this.main.bot.sendChatAction(chatId, 'typing').catch((err) => {
          const isBlocked = isBlockedError(err);
          if (isBlocked) {
            const body = err.response.body;
            return this.main.db.deleteChatById(chatId).then(() => {
              result.removedCount++;
              offset--;
              this.main.chat.log.write(`[deleted] ${chatId}, cause: (${body.error_code}) ${JSON.stringify(body.description)}`);
            });
          } else {
            debug('cleanChats sendChatAction typing to %s error, cause: %o', chatId, err);
            result.errorCount++;
          }
        });
      });
    }
    return result;
  }
}

export default Sender;