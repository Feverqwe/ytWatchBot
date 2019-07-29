import getProvider from "./tools/getProvider";
import ChatSender, {isBlockedError} from "./chatSender";
import LogFile from "./logFile";
import parallel from "./tools/parallel";
import {everyMinutes} from "./tools/everyTime";
import getInProgress from "./tools/getInProgress";

const debug = require('debug')('app:Sender');
const throttle = require('lodash.throttle');

class Sender {
  constructor(/**Main*/main) {
    this.main = main;
    this.log = new LogFile('sender');
  }

  init() {
    this.startCheckInterval();
  }

  checkTimer = null;
  startCheckInterval() {
    this.checkTimer && this.checkTimer();
    this.checkTimer = everyMinutes(this.main.config.emitSendMessagesEveryMinutes, () => {
      this.check().catch((err) => {
        debug('check error', err);
      });
    });
  }

  check = () => {
    return this.main.db.getDistinctChatIdVideoIdChatIds().then((chatIds) => {
      const newChatIds = chatIds.filter(chatId => !this.chatIdChatSender.has(chatId));
      return this.main.db.getChatsByIds(newChatIds).then((chats) => {
        chats.forEach((chat) => {
          const chatSender = new ChatSender(this.main, chat);
          this.chatIdChatSender.set(chat.id, chatSender);
          this.suspended.push(chatSender);
        });

        this.fillThreads();

        return {addedCount: chats.length};
      });
    });
  };
  checkThrottled = throttle(this.check, 1000, {
    leading: false
  });

  threadLimit = 10;
  chatIdChatSender = new Map();
  suspended = [];
  threads = [];

  fillThreads() {
    for (let i = 0; i < this.threadLimit; i++) {
      this.runThread();
    }
  }

  runThread() {
    const {threadLimit, chatIdChatSender, suspended, threads} = this;

    if (!suspended.length && !threads.length) return;
    if (!suspended.length || threads.length === threadLimit) return;

    const chatSender = suspended.shift();
    threads.push(chatSender);

    return chatSender.next().catch(async (err) => {
      debug('chatSender %s stopped, cause: %o', chatSender.chat.id, err);
      await this.main.db.setChatSendTimeoutExpiresAt([chatSender.chat.id]);
      return true;
    }).then((isDone) => {
      const pos = threads.indexOf(chatSender);
      if (pos !== -1) {
        threads.splice(pos, 1);
      }
      if (isDone) {
        chatIdChatSender.delete(chatSender.chat.id);
      } else {
        suspended.push(chatSender);
      }
      this.fillThreads();
    });
  }

  provideVideo = getProvider((id) => {
    return this.main.db.getVideoWithChannelById(id);
  }, 100);

  checkChatsExistsInProgress = getInProgress();
  checkChatsExists() {
    return this.checkChatsExistsInProgress(async () => {
      let offset = 0;
      let limit = 100;
      const result = {
        chatCount: 0,
        removedCount: 0,
        errorCount: 0,
      };
      while (true) {
        const chatIds = await this.main.db.getChatIds(offset, limit);
        offset += limit;
        if (!chatIds.length) break;

        const blockedChatIds = [];

        await parallel(10, chatIds, (chatId) => {
          result.chatCount++;
          return this.main.bot.sendChatAction(chatId, 'typing').catch((err) => {
            const isBlocked = isBlockedError(err);
            if (isBlocked) {
              blockedChatIds.push(chatId);
              const body = err.response.body;
              this.main.chat.log.write(`[deleted] ${chatId}, cause: (${body.error_code}) ${JSON.stringify(body.description)}`);
            } else {
              debug('cleanChats sendChatAction typing to %s error, cause: %o', chatId, err);
              result.errorCount++;
            }
          });
        });

        await this.main.db.deleteChatsByIds(blockedChatIds);

        result.removedCount += blockedChatIds.length;
        offset -= blockedChatIds.length;
      }
      return result;
    });
  }
}

export default Sender;