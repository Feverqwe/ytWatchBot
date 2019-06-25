import promiseFinally from "./tools/promiseFinally";
import getProvider from "./tools/getProvider";

const debug = require('debug')('app:Sender');
const promiseLimit = require('promise-limit');

const oneLimit = promiseLimit(1);

class Sender {
  constructor(/**Main*/main) {
    this.main = main;
  }

  init() {
    this.startCheckInterval();
  }

  checkIntervalId = null;
  startCheckInterval() {
    clearInterval(this.checkIntervalId);
    this.checkIntervalId = setInterval(() => {
      this.check();
    }, 5 * 60 * 1000);
  }

  check() {
    return this.main.db.getDistinctChatIdVideoIdChatIds().then((chatIds) => {
      chatIds = chatIds.filter(chatId => !this.chatIdGenerator.has(chatId));
      return this.main.db.setChatSubscriptionTimeoutExpiresAt(chatIds).then(() => {
        return this.main.db.getChatsByIds(chatIds).then((chats) => {
          const chatIdChat = new Map();
          chats.forEach((chat) => {
            chatIdChat.set(chat.id, chat);
          });

          let addedCount = 0;
          chatIds.forEach((chatId) => {
            const chat = chatIdChat.get(chatId);
            if (!chat) {
              debug('check chat %s skip, cause chat not found!', chatId);
              return;
            }

            addedCount++;
            const gen = this.getChatSenderGenerator(chat);
            gen.chatId = chatId;
            this.chatIdGenerator.set(chatId, gen);
            this.suspendedGenerators.push(gen);
          });

          this.runGenerators();

          return {addedCount: addedCount};
        });
      });
    });
  }

  suspendedGenerators = [];
  chatIdGenerator = new Map();
  threads = [];

  runGenerators() {
    return oneLimit(() => {
      return new Promise(((resolve, reject) => {
        const {chatIdGenerator, suspendedGenerators, threads} = this;
        const threadLimit = 10;
        let canceled = false;

        return fillThreads();

        function fillThreads() {
          for (let i = 0; i < threadLimit; i++) {
            runThread();
          }
        }

        function runThread() {
          if (!suspendedGenerators.length && !threads.length || canceled) return resolve();
          if (!suspendedGenerators.length || threads.length === threadLimit) return;

          const gen = suspendedGenerators.shift();
          threads.push(gen);

          let ret = null;

          try {
            const {lastError: err, lastResult: result} = gen;
            gen.lastResult = gen.lastError = undefined;

            ret = err ? gen.throw(err) : gen.next(result);

            if (ret.done) return onFinish();

            ret.value.then((result) => {
              gen.lastResult = result;
            }, (err) => {
              gen.lastError = err;
            }).then(onFinish);
          } catch (err) {
            canceled = true;
            return reject(err);
          }

          function onFinish() {
            const pos = threads.indexOf(gen);
            if (pos !== -1) {
              threads.splice(pos, 1);
            }
            if (!ret.done) {
              suspendedGenerators.push(gen);
            } else {
              chatIdGenerator.delete(gen.chatId);
            }
            fillThreads();
          }
        }
      }));
    });
  }

  getChatSenderGenerator = function* (chat) {
    const self = this;
    let offset = 0;
    const getVideoIds = () => {
      const prevOffset = offset;
      offset += 10;
      return this.main.db.getVideoIdsByChatId(chat.id, 10, prevOffset);
    };

    let videoIds = null;
    while (true) {
      if (!videoIds || !videoIds.length) {
        videoIds = yield getVideoIds();
      }

      if (!videoIds.length) break;

      yield self.provideVideo(videoIds.shift(), (video) => {
        console.log(chat.id, video.id);
        // return this.main.db.deleteChatIdVideoId(chat.id, video.id);
      });
    }
  }.bind(this);

  provideVideo = getProvider((id) => {
    return this.main.db.getVideoById(id);
  });
}

export default Sender;