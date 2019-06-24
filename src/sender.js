const debug = require('debug')('app:Checker');
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
    return oneLimit(() => {
      return this.main.db.getDistinctChatIdVideoIdChatIds().then((chatIds) => {
        return new Promise(((resolve, reject) => {
          const suspendedGenerators = chatIds.map((chatId) => {
            return this.chatSenderGenerator(chatId);
          });
          const threadLimit = 10;
          const threads = [];
          let canceled = false;
          const next = () => {
            if (!suspendedGenerators.length && !threads.length || canceled) return resolve();
            if (!suspendedGenerators.length) return;
            const generator = suspendedGenerators.shift();

            const onFinish = () => {
              const pos = threads.indexOf(generator);
              if (pos !== -1) {
                threads.splice(pos, 1);
              }
              if (!ret.done) {
                suspendedGenerators.push(generator);
              }
              if (suspendedGenerators.length) {
                next();
              }
            };

            threads.push(generator);

            let ret = null;
            try {
              const {lastError: err, lastResult: result} = generator;
              generator.lastResult = generator.lastError = undefined;
              if (err) {
                ret = generator.throw(err);
              } else {
                ret = generator.next(result);
              }
            } catch (err) {
              canceled = true;
              return reject(err);
            }

            if (ret.done) {
              return setImmediate(onFinish);
            }

            ret.value.then((result) => {
              generator.lastResult = result;
            }, (err) => {
              generator.lastError = err;
            }).then(onFinish);
          };

          for (let i = 0; i < threadLimit; i++) {
            next();
          }
        }));
      });
    });
  }

  chatSenderGenerator = function* (chatId) {
    let offset = 0;
    const getVideoIds = () => {
      const prevOffset = offset;
      offset += 10;
      return this.main.db.getVideoIdsByChatId(chatId, 10, prevOffset);
    };

    let videoIds = yield getVideoIds();
    while (videoIds.length) {
      const videoId = videoIds.shift();

      yield new Promise(r => setTimeout(r, 500)).then(() => {
        console.log(chatId, videoId);
      });

      if (!videoIds.length) {
        videoIds = yield getVideoIds();
      }
    }
  }.bind(this);
}

export default Sender;