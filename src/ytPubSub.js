import parallel from "./tools/parallel";
import ErrorWithCode from "./tools/errorWithCode";
import arrayDifferent from "./tools/arrayDifferent";

const debug = require('debug')('app:YtPubSub');
const path = require('path');
const pubSubHubbub = require(path.join(__dirname, '../src/vendor/pubsubhubbub'));
const {XmlDocument} = require("xmldoc");
const qs = require('querystring');
const promiseLimit = require('promise-limit');
const throttle = require('lodash.throttle');

const oneLimit = promiseLimit(1);

class YtPubSub {
  constructor(/**Main*/main) {
    this.main = main;
    this.hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';
  }

  init() {
    this.pubsub = pubSubHubbub.createServer(this.main.config.push);

    return new Promise((resolve, reject) => {
      this.initListener((err) => err ? reject(err) : resolve());
    }).then(() => {
      this.startUpdateInterval();
      this.startCleanInterval();
    });
  }

  updateIntervalId = null;
  startUpdateInterval() {
    clearInterval(this.updateIntervalId);
    this.updateIntervalId = setInterval(() => {
      this.updateSubscribes();
    }, 5 * 60 * 1000);
  }

  cleanIntervalId = null;
  startCleanInterval() {
    clearInterval(this.cleanIntervalId);
    this.cleanIntervalId = setInterval(() => {
      this.clean();
    }, 60 * 60 * 1000);
  }

  updateSubscribes() {
    return oneLimit(() => {
      return this.main.db.getChannelsWithExpiresSubscription().then((channels) => {
        const channelIds = channels.map(channel => channel.id);
        return this.main.db.setChannelsSubscriptionTimeoutExpiresAt(channelIds, 5).then(() => {
          const expiresAt = new Date();
          expiresAt.setSeconds(expiresAt.getSeconds() + this.main.config.push.leaseSeconds);

          const subscribedChannelIds = [];
          return parallel(10, channels, (channel) => {
            const rawId = channel.rawId;
            return this.subscribe(rawId).then(() => {
              subscribedChannelIds.push(channel.id);
            }).catch((err) => {
              debug('subscribe channel %s skip, cause error! %o', channel.id, err);
            });
          }).then(() => {
            return this.main.db.setChannelsSubscriptionExpiresAt(subscribedChannelIds, expiresAt).then((affectedRows) => {
              return {affectedRows};
            });
          });
        });
      });
    });
  }

  clean() {
    return oneLimit(() => {
      return this.main.db.cleanYtPubSub().then((count) => {
        return {removedVideoIds: count};
      });
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
    this.pubsub.on("listen", () => {
      callback();
    });

    this.pubsub.on('error', (err) => {
      callback(err);
    });

    this.pubsub.on('denied', (err) => {
      debug('Denied', err);
    });

    this.pubsub.on('feed', (data) => {
      try {
        const feed = parseData(data.feed.toString());
        this.handleFeed(feed);
      } catch (err) {
        if (err.code === 'ENTRY_IS_DELETED') {
          // pass
        } else {
          debug('Parse xml error!', err);
        }
      }
    });

    this.pubsub.listen(this.main.config.push.port);
  }

  feeds = [];
  emitFeedsChanges = () => {
    const videoIdChannelId = {};
    const videoIds = [];
    this.feeds.forEach(({videoId, channelId}) => {
      if (!videoIds.includes(videoId)) {
        videoIds.push(videoId);
        videoIdChannelId[videoId] = channelId;
      }
    });

    return this.main.db.getExistsYtPubSubVideoIds(videoIds).then((existsVideoIds) => {
      const newVideoIds = arrayDifferent(videoIds, existsVideoIds);

      const channelIds = [];
      const ytPubSubItems = [];
      newVideoIds.forEach((videoId) => {
        const rawChannelId = videoIdChannelId[videoId];
        const channelId = this.main.db.model.Channel.buildId('youtube', rawChannelId);
        if (!channelIds.includes(channelId)) {
          channelIds.push(channelId);
        }
        ytPubSubItems.push({videoId, lastPushAt: new Date()});
      });

      return this.main.db.putYtPubSub(existsVideoIds, ytPubSubItems, channelIds);
    }).catch((err) => {
      debug('emitFeedsChanges error %o', err);
    });
  };
  emitFeedsChangesThrottled = throttle(this.emitFeedsChanges, 60 * 1000, {
    leading: false
  });

  handleFeed({videoId, channelId}) {
    this.feeds.push({videoId, channelId});
    this.emitFeedsChangesThrottled();
  }
}

function parseData(xml) {
  const document = new XmlDocument(xml);

  const entry = getChildNode(document, 'entry');

  if (!entry) {
    const isDeletedEntry = !!getChildNode(document, 'at:deleted-entry');
    if (!isDeletedEntry) {
      debug('Unknown entry %j', document.toString({compressed: true}));
    }
    throw new ErrorWithCode('Entry deleted!', 'ENTRY_IS_DELETED');
  }

  const data = {};

  const success = ['yt:videoId', 'yt:channelId'].every((item) => {
    const node = getChildNode(entry, item);
    if (node) {
      data[item] = node.val;
      return true;
    }
  });

  if (!success) {
    debug('XML read error! %j', document.toString({compressed: true}));
    throw new Error('parseData error');
  }

  return {videoId: data['yt:videoId'], channelId: data['yt:channelId']};
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

export default YtPubSub;