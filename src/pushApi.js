import parallel from "./tools/parallel";
import getNow from "./tools/getNow";

const debug = require('debug')('app:PushApi');
const path = require('path');
const pubSubHubbub = require(path.join(__dirname, '../src/vendor/pubsubhubbub'));
const xmldoc = require("xmldoc");
const qs = require('querystring');
const promiseLimit = require('promise-limit');

const tenLimit = promiseLimit(10);

class PushApi {
  constructor(/**Main*/main) {
    this.main = main;
    this.hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';
  }

  init() {
    this.pubsub = pubSubHubbub.createServer(this.main.config.push);

    this.main.on('subscribe', (/*dbChannel[]*/channels) => {
      /*if (!Array.isArray(channels)) {
        channels = [channels];
      }

      const now = getNow();

      const subscribeChannels = channels.filter((channel) => {
        return channel.subscribeExpire < now;
      });

      parallel(10, subscribeChannels, (channel) => {
        return tenLimit(() => {
          const ytChannelId = this.main.channels.unWrapId(channel.id);
          return this.subscribe(ytChannelId).then(() => {
            // debug('[manual] (s) %s', channel.id);
            channel.subscribeExpire = now + (this.main.config.push.leaseSeconds / 2);
            return this.main.channels.updateChannel(channel.id, {
              subscribeExpire: channel.subscribeExpire
            });
          }).catch((err) => {
            debug('Subscribe error! %s %o', channel.id, err);
          });
        });
      });*/
    });

    this.main.on('unsubscribe', (channelIds) => {
      /*if (!Array.isArray(channelIds)) {
        channelIds = [channelIds];
      }

      parallel(10, channelIds, (channelId) => {
        return tenLimit(() => {
          const ytChannelId = this.main.channels.unWrapId(channelId);
          return this.unsubscribe(ytChannelId).then(() => {
            // debug('[manual] (u) %s', channelId);
            return this.main.channels.updateChannel(channelId, {
              subscribeExpire: 0
            });
          }).catch((err) => {
            debug('Unsubscribe error! %s %o', channelId, err);
          });
        });
      });*/
    });

    return new Promise((resolve, reject) => {
      this.initListener((err) => err ? reject(err) : resolve());
    });
  }

  subscribe(channelId) {
    const topicUrl = getTopicUrl(channelId);

    return new Promise((resolve, reject) => {
      this.pubsub.subscribe(topicUrl, this.hubUrl, (err, topic) => {
        err ? reject(err) : resolve(topic);
      });
    });
  }

  unsubscribe(channelId) {
    const topicUrl = getTopicUrl(channelId);

    return new Promise((resolve, reject) => {
      this.pubsub.unsubscribe(topicUrl, this.hubUrl, (err, topic) => {
        err ? reject(err) : resolve(topic);
      });
    });
  }

  initListener(callback) {
    const pubsub = this.pubsub;

    pubsub.on("listen", () => {
      callback();
    });

    pubsub.on('error', (err) => {
      callback(err);
      debug('Error', err);
    });

    pubsub.on('denied', (err) => {
      debug('Denied', err);
    });

    pubsub.on('feed', (data) => {
      try {
        const feed = this.prepareData(data.feed.toString());
        this.main.emit('feed', feed);
      } catch (err) {
        if (err.message === 'Entry is not found!') {
          return;
        }

        debug('Parse xml error!', err);
      }
    });

    this.pubsub.listen(this.main.config.push.port);
  }

  prepareData(xml) {
    const document = new xmldoc.XmlDocument(xml);

    const entry = getChildNode(document, 'entry');

    if (!entry) {
      const isDeletedEntry = !!getChildNode(document, 'at:deleted-entry');
      if (!isDeletedEntry) {
        debug('Unknown entry %j', document.toString({compressed: true}));
      }
      throw new Error('Entry is not found!');
    }

    const data = {};

    const success = ['yt:videoId', 'yt:channelId'].every((item) => {
      const node = getChildNode(entry, item);
      if (!node) {
        return false;
      }

      data[item] = node.val;

      return !!data[item];
    });

    if (!success) {
      debug('XML read error! %j', document.toString({compressed: true}));
      throw new Error('XML read error!');
    }

    return data;
  }
}

function getTopicUrl(channelId) {
  return 'https://www.youtube.com/xml/feeds/videos.xml' + '?' + qs.stringify({
    channel_id: channelId
  });
}

function getChildNode(root, name) {
  let el = null;
  if (root && root.children) {
    for (let i = 0, node; node = root.children[i]; i++) {
      if (node.name === name) {
        return node;
      }
    }
  }
  return el;
}

export default PushApi;