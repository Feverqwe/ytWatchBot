import parallel from './tools/parallel';
import ErrorWithCode from './tools/errorWithCode';
import getInProgress from './tools/getInProgress';
import serviceId from './tools/serviceId';
import {everyMinutes} from './tools/everyTime';
import ExpressPubSub from './tools/expressPubSub';
import promiseLimit from './tools/promiseLimit';
import qs from 'node:querystring';
import Main from './main';
import {IncomingHttpHeaders} from 'node:http';
import {NewChannel} from './db';
import {appConfig} from './appConfig';
import throttle from 'lodash.throttle';
import {getDebug} from './tools/getDebug';
import {XmlDocument, XmlElement} from 'xmldoc';
import {Express} from 'express';

const debug = getDebug('app:YtPubSub');

const oneLimit = promiseLimit(1);
const checkOneLimit = promiseLimit(1);

class YtPubSub {
  private hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';
  private expressPubSub = new ExpressPubSub({
    path: appConfig.push.path,
    secret: appConfig.push.secret,
    callbackUrl: appConfig.push.callbackUrl,
    leaseSeconds: appConfig.push.leaseSeconds,
  });

  constructor(private main: Main) {}

  init(expressApp: Express) {
    this.expressPubSub.bind(expressApp);
    this.expressPubSub.on('denied', (data: any) => {
      debug('Denied %o', data);
    });
    this.expressPubSub.on('feed', (data: PubSubFeed) => {
      this.handleFeed(data);
    });

    this.startUpdateInterval();
    this.startCleanInterval();
  }

  updateTimer: (() => void) | null = null;
  startUpdateInterval() {
    this.updateTimer && this.updateTimer();
    this.updateTimer = everyMinutes(appConfig.emitUpdateChannelPubSubSubscribeEveryMinutes, () => {
      this.updateSubscribes().catch((err) => {
        debug('updateSubscribes error', err);
      });
    });
  }

  cleanTimer: (() => void) | null = null;
  startCleanInterval() {
    this.cleanTimer && this.cleanTimer();
    this.cleanTimer = everyMinutes(appConfig.emitCleanPubSubFeedEveryHours * 60, () => {
      this.clean().catch((err) => {
        debug('clean error', err);
      });
    });
  }

  inProgress = getInProgress();

  updateSubscribes = () => {
    return this.inProgress(() =>
      oneLimit(async () => {
        while (true) {
          const channelIds = await this.main.db.getChannelIdsWithExpiresSubscription();
          if (!channelIds.length) {
            break;
          }

          await this.main.db.setChannelsSubscriptionTimeoutExpiresAt(channelIds).then(() => {
            const expiresAt = new Date();
            expiresAt.setSeconds(expiresAt.getSeconds() + appConfig.push.leaseSeconds);

            const subscribedChannelIds: string[] = [];
            return parallel(10, channelIds, (id) => {
              const rawId = serviceId.unwrap(id);
              return this.subscribe(rawId).then(
                () => {
                  subscribedChannelIds.push(id);
                },
                (err) => {
                  debug('subscribe channel %s skip, cause: %o', id, err);
                },
              );
            }).then(() => {
              return this.main.db
                .setChannelsSubscriptionExpiresAt(subscribedChannelIds, expiresAt)
                .then(([affectedRows]) => {
                  return {affectedRows};
                });
            });
          });
        }
      }),
    );
  };

  clean = () => {
    return oneLimit(() => {
      return this.main.db.cleanYtPubSub().then((count) => {
        return {removedVideoIds: count};
      });
    });
  };

  subscribe(channelId: string) {
    const topicUrl = getTopicUrl(channelId);

    return this.expressPubSub.subscribe(topicUrl, this.hubUrl);
  }

  unsubscribe(channelId: string) {
    const topicUrl = getTopicUrl(channelId);

    return this.expressPubSub.unsubscribe(topicUrl, this.hubUrl);
  }

  feeds: Feed[] = [];
  emitFeedsChanges = () => {
    return checkOneLimit(async () => {
      while (this.feeds.length) {
        const feeds = this.feeds.splice(0);

        const defaultDate = this.main.checker.getDefaultDate();

        const videoIdsFromFeeds: string[] = [];
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

        await this.main.db
          .getNoExistsVideoIds(videoIdsFromFeeds)
          .then((videoIds) => {
            const feedChannelIds: string[] = [];
            videoIds.forEach((videoId) => {
              const feed = videoIdFeed.get(videoId);

              const channelId = serviceId.wrap(this.main.youtube, feed.channelId);

              if (!feedChannelIds.includes(channelId)) {
                feedChannelIds.push(channelId);
              }
            });

            return this.main.checker.oneLimit(() => {
              return this.main.db.getChannelsByIds(feedChannelIds).then((channels) => {
                const channelIds: string[] = [];
                const channelIdChanges = new Map<string, NewChannel>();
                channels.forEach((channel) => {
                  if (!channelIds.includes(channel.id)) {
                    channelIds.push(channel.id);
                  }

                  const publishedAt = channelIdPublishedAt.get(channel.id);
                  const videoId = channelIdPublishedVideoId.get(channel.id);
                  const lastVideoPublishedAt = channel.lastVideoPublishedAt;

                  if (
                    lastVideoPublishedAt &&
                    lastVideoPublishedAt.getTime() > publishedAt.getTime()
                  ) {
                    channelIdChanges.set(
                      channel.id,
                      Object.assign({}, channel.get({plain: true}), {
                        lastVideoPublishedAt: new Date(publishedAt.getTime() - 1000),
                      }),
                    );
                    // debug('[change channel]', channel.id, 'from', lastVideoPublishedAt.toISOString(), 'to', publishedAt.toISOString(), 'cause', videoId);
                  }
                });

                const channelsChanges = Array.from(channelIdChanges.values());

                return this.main.db.putYtPubSub(feeds, channelsChanges, channelIds);
              });
            });
          })
          .catch((err: Error & any) => {
            debug('emitFeedsChanges error %o', err);
          });
      }
    });
  };
  emitFeedsChangesThrottled = throttle(this.emitFeedsChanges, 1000, {
    leading: false,
  });

  handleFeed(data: PubSubFeed) {
    try {
      /*this.log.write('data', JSON.stringify({
        topic: data.topic,
        callback: data.callback,
        feed: data.feed.toString()
      }));*/
      const feed = parseData(data.feed.toString());
      this.feeds.push(Object.assign(feed, {lastPushAt: new Date()}));
      this.emitFeedsChangesThrottled();
    } catch (err: Error & any) {
      if (err.code === 'ENTRY_IS_DELETED') {
        // pass
      } else {
        debug('parseData skip, cause: %o', err);
      }
    }
  }
}

interface PubSubFeed {
  topic: string | undefined;
  hub: string | undefined;
  callback: string;
  feed: Buffer;
  headers: IncomingHttpHeaders;
}

export interface Feed {
  videoId: string;
  channelId: string;
  publishedAt: Date;
}

function parseData(xml: string): Feed {
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

    const data: {[s: string]: string} = {};
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

    return {
      videoId: data['yt:videoId'],
      channelId: data['yt:channelId'],
      publishedAt: new Date(data.published),
    };
  } catch (err) {
    debug(
      'parseData error, cause: Some data is not found %j',
      document.toString({compressed: true}),
    );
    throw err;
  }
}

function getTopicUrl(channelId: string) {
  return (
    'https://www.youtube.com/xml/feeds/videos.xml' +
    '?' +
    qs.stringify({
      channel_id: channelId,
    })
  );
}

function getChildNode(root: XmlElement | XmlDocument, name: string): XmlElement | null {
  if (root.children) {
    for (let i = 0, node; (node = root.children[i]); i++) {
      if ('name' in node && node.name === name) {
        return node;
      }
    }
  }
  return null;
}

export default YtPubSub;
