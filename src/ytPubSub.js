import parallel from "./tools/parallel";
import ErrorWithCode from "./tools/errorWithCode";
import roundStartInterval from "./tools/roundStartInterval";
import getInProgress from "./tools/getInProgress";
import LogFile from "./logFile";
import serviceId from "./tools/serviceId";

const debug = require('debug')('app:YtPubSub');
const path = require('path');
const pubSubHubbub = require(path.join(__dirname, '../src/vendor/pubsubhubbub'));
const {XmlDocument} = require("xmldoc");
const qs = require('querystring');
const promiseLimit = require('promise-limit');
const throttle = require('lodash.throttle');

const oneLimit = promiseLimit(1);
const checkOneLimit = promiseLimit(1);

class YtPubSub {
  constructor(/**Main*/main) {
    this.main = main;
    this.hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';
    this.log = new LogFile('ytPubSub');
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
    this.updateIntervalId = roundStartInterval(() => {
      this.updateIntervalId = setInterval(() => {
        this.updateSubscribes();
      }, 5 * 60 * 1000);
      this.updateSubscribes();
    });
  }

  cleanIntervalId = null;
  startCleanInterval() {
    clearInterval(this.cleanIntervalId);
    this.cleanIntervalId = setInterval(() => {
      this.clean();
    }, 60 * 60 * 1000);
  }

  inProgress = getInProgress();

  updateSubscribes() {
    return this.inProgress(() => oneLimit(async () => {
      while (true) {
        const channels = await this.main.db.getChannelsWithExpiresSubscription(50);
        if (!channels.length) {
          break;
        }

        const channelIds = channels.map(channel => channel.id);
        await this.main.db.setChannelsSubscriptionTimeoutExpiresAt(channelIds, 5).then(() => {
          const expiresAt = new Date();
          expiresAt.setSeconds(expiresAt.getSeconds() + this.main.config.push.leaseSeconds);

          const subscribedChannelIds = [];
          return parallel(10, channels, (channel) => {
            const rawId = serviceId.unwrap(channel.id);
            return this.subscribe(rawId).then(() => {
              subscribedChannelIds.push(channel.id);
            }, (err) => {
              debug('subscribe channel %s skip, cause: %o', channel.id, err);
            });
          }).then(() => {
            return this.main.db.setChannelsSubscriptionExpiresAt(subscribedChannelIds, expiresAt).then(([affectedRows]) => {
              return {affectedRows};
            });
          });
        });
      }
    }));
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
      debug('Denied %o', err);
    });

    this.pubsub.on('feed', (data) => {
      this.handleFeed(data);
    });

    this.pubsub.listen(this.main.config.push.port);
  }

  feeds = [];
  emitFeedsChanges = () => {
    return checkOneLimit(async () => {
      while (this.feeds.length) {
        const feeds = this.feeds.splice(0);

        const defaultDate = this.main.checker.getDefaultDate();

        const videoIdsFromFeeds = [];
        const channelIdPublishedAt = new Map();
        const channelIdPublishedVideoId = new Map();
        const videoIdFeed = new Map();
        feeds.forEach((feed) => {
          if (feed.publishedAt.getTime() < defaultDate.getTime()) return;

          const videoId = serviceId.wrap(this.main.youtube, feed.videoId);
          const channelId = serviceId.wrap(this.main.youtube, feed.channelId);

          if (!videoIdsFromFeeds.includes(videoId)) {
            videoIdsFromFeeds.push(videoId);
          }

          let publishedAt = channelIdPublishedAt.get(channelId);
          if (!publishedAt || publishedAt.getTime() > feed.publishedAt.getTime()) {
            channelIdPublishedAt.set(channelId, feed.publishedAt);
            channelIdPublishedVideoId.set(channelId, videoId);
          }

          videoIdFeed.set(videoId, feed);
        });

        await this.main.db.getNoExistsVideoIds(videoIdsFromFeeds).then((videoIds) => {
          const feedChannelIds = [];
          videoIds.forEach((videoId) => {
            const feed = videoIdFeed.get(videoId);

            const channelId = serviceId.wrap(this.main.youtube, feed.channelId);

            if (!feedChannelIds.includes(channelId)) {
              feedChannelIds.push(channelId);
            }
          });

          return this.main.checker.oneLimit(() => {
            return this.main.db.getChannelsByIds(feedChannelIds).then((channels) => {
              const channelIds = [];
              const channelIdChanges = new Map();
              channels.forEach((channel) => {
                if (!channelIds.includes(channel.id)) {
                  channelIds.push(channel.id);
                }

                const publishedAt = channelIdPublishedAt.get(channel.id);
                const videoId = channelIdPublishedVideoId.get(channel.id);
                const lastVideoPublishedAt = channel.lastVideoPublishedAt;

                if (lastVideoPublishedAt && lastVideoPublishedAt.getTime() > publishedAt.getTime()) {
                  channelIdChanges.set(channel.id, Object.assign({}, channel.get({plain: true}), {
                    lastVideoPublishedAt: new Date(publishedAt.getTime() - 1000),
                  }));
                  debug('[change channel]', channel.id, 'from', lastVideoPublishedAt.toISOString(), 'to', publishedAt.toISOString(), 'cause', videoId);
                }
              });

              const channelsChanges = Array.from(channelIdChanges.values());

              return this.main.db.putYtPubSub(feeds, channelsChanges, channelIds);
            });
          });
        }).catch((err) => {
          debug('emitFeedsChanges error %o', err);
        });
      }
    });
  };
  emitFeedsChangesThrottled = throttle(this.emitFeedsChanges, 1000, {
    leading: false
  });

  handleFeed(data) {
    try {
      this.log.write('data', JSON.stringify({
        topic: data.topic,
        callback: data.callback,
        feed: data.feed.toString()
      }));
      const feed = parseData(data.feed.toString(), this.log.write.bind(this.log));
      this.feeds.push(Object.assign(feed, {lastPushAt: new Date()}));
      this.emitFeedsChangesThrottled();
    } catch (err) {
      if (err.code === 'ENTRY_IS_DELETED') {
        // pass
      } else {
        debug('parseData skip, cause: %o', err);
      }
    }
  }
}

function parseData(xml) {
  const document = new XmlDocument(xml);

  const entry = getChildNode(document, 'entry');
  if (!entry) {
    const isDeletedEntry = !!getChildNode(document, 'at:deleted-entry');
    if (isDeletedEntry) {
      throw new ErrorWithCode('Entry deleted!', 'ENTRY_IS_DELETED');
    }
  }

  try {
    if (!entry) {
      throw new ErrorWithCode('Entry is not found!', 'ENTRY_IS_NOT_FOUND');
    }

    const data = {};
    const success = ['yt:videoId', 'yt:channelId', 'published', 'author'].every((item) => {
      const node = getChildNode(entry, item);
      if (node) {
        data[item] = node.val;
        return true;
      }
    });
    if (!success) {
      throw new ErrorWithCode('Some fields is not found', 'SOME_FIELDS_IS_NOT_FOUND');
    }

    return {videoId: data['yt:videoId'], channelId: data['yt:channelId'], publishedAt: new Date(data.published)};
  } catch (err) {
    debug('parseData error, cause: Some data is not found %j', document.toString({compressed: true}));
    throw err;
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

export default YtPubSub;