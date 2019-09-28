import ErrorWithCode from "../tools/errorWithCode";
import {struct} from "superstruct";
import RateLimit from "../tools/rateLimit";
import arrayByPart from "../tools/arrayByPart";
import parallel from "../tools/parallel";
import formatDuration from "../tools/formatDuration";
import ensureMap from "../tools/ensureMap";
import promiseTry from "../tools/promiseTry";
import {gotLockTimeout} from "../tools/gotWithTimeout";

const got = require('got');
const debug = require('debug')('app:Youtube');

const rateLimit = new RateLimit(1000);
const gotLimited = rateLimit.wrap((url, options) => {
  return gotLockTimeout(got(url, options), 2.5 * 60 * 1000);
});

const VideosItemsSnippet = struct.partial({
  items: [struct.partial({
    snippet: struct.partial({
      channelId: 'string'
    })
  })]
});

const ChannelsItemsId = struct.partial({
  items: [struct.partial({
    id: 'string'
  })],
  nextPageToken: 'string?'
});

const SearchItemsId = struct.partial({
  items: [struct.partial({
    id: struct.partial({
      channelId: 'string'
    })
  })]
});

const SearchItemsSnippet = struct.partial({
  items: [struct.partial({
    snippet: struct.partial({
      channelId: 'string',
      channelTitle: 'string'
    })
  })]
});

const ActivitiesResponse = struct.partial({
  items: [struct.partial({
    contentDetails: struct.partial({
      upload: struct.partial({
        videoId: 'string'
      })
    }),
  })],
  nextPageToken: 'string?'
});

const VideosResponse = struct.partial({
  items: [struct.partial({
    id: 'string',
    snippet: struct.partial({
      publishedAt: 'string', // 2007-03-05T08:22:25.000Z
      channelId: 'string',
      title: 'string',
      // description: 'string',
      thumbnails: struct.dict(['string', struct.partial({
        url: 'string',
        width: 'number',
        height: 'number',
      })]),
      channelTitle: 'string',
      // tags: ['string'],
      // categoryId: 'string', // 10
      // liveBroadcastContent: 'string', // none
      // localized: struct.partial({
      //   title: 'string',
      //   description: 'string',
      // })
    }),
    contentDetails: struct.partial({
      duration: 'string', // PT2M57S
      // dimension: 'string', // 2d
      // definition: 'string', // sd
      // caption: 'string', // false
      // licensedContent: 'boolean', // true
      // projection: 'string', // rectangular
    }),
  })],
  nextPageToken: 'string?'
});

class Youtube {
  constructor(/**Main*/main) {
    this.main = main;
    this.id = 'youtube';
    this.name = 'Youtube';
  }

  getVideos(channels, filterFn) {
    return this.getVideoIds(channels).then(({videoIds, videoIdChannelIds, skippedChannelIds}) => {
      return filterFn(videoIds).then((videoIds) => {
        return this.getVideosByIds(videoIds);
      }).then((videos) => {
        return {videos, videoIdChannelIds, skippedChannelIds};
      });
    });
  }

  getVideosByIds(videoIds) {
    const resultVideos = [];
    return parallel(10, arrayByPart(videoIds, 50), (videoIds) => {
      return iterPages((pageToken) => {
        return gotLimited('https://www.googleapis.com/youtube/v3/videos', {
          query: {
            part: 'snippet,contentDetails',
            id: videoIds.join(','),
            pageToken: pageToken,
            fields: 'items/id,items/snippet,items/contentDetails,nextPageToken',
            key: this.main.config.ytToken
          },
          json: true,
        }).then(({body}) => {
          const videos = VideosResponse(body);

          videos.items.forEach((video) => {
            const previews = Object.values(video.snippet.thumbnails).sort((a, b) => {
              return a.width > b.width ? -1 : 1;
            }).map(thumbnail => thumbnail.url);

            let duration = null;
            try {
              duration = formatDuration(video.contentDetails.duration);
            } catch (err) {
              debug('formatDuration %s error %o', video.id, err);
            }

            const result = {
              id: video.id,
              url: getVideoUrl(video.id),
              title: video.snippet.title,
              previews: previews,
              duration: duration,
              channelId: video.snippet.channelId,
              channelTitle: video.snippet.channelTitle,
              publishedAt: new Date(video.snippet.publishedAt),
            };

            resultVideos.push(result);
          });

          return videos.nextPageToken;
        });
      });
    }).then(() => resultVideos);
  }

  getVideoIds(channels) {
    const resultSkippedChannelIds = [];
    const videoIdChannelIds = new Map();
    const resultVideoIds = [];
    return parallel(10, channels, ({id: channelId, publishedAfter}) => {
      const videoIds = [];
      return iterPages((pageToken) => {
        return gotLimited('https://www.googleapis.com/youtube/v3/activities', {
          query: {
            part: 'contentDetails',
            channelId: channelId,
            maxResults: 50,
            pageToken: pageToken,
            fields: 'items/contentDetails/upload/videoId,nextPageToken',
            publishedAfter: publishedAfter.toISOString(),
            key: this.main.config.ytToken
          },
          json: true,
        }).then(({body}) => {
          const activities = ActivitiesResponse(body);
          activities.items.forEach((item) => {
            const videoId = item.contentDetails.upload.videoId;
            videoIds.push(videoId);
          });

          return activities.nextPageToken;
        });
      }).then(() => {
        videoIds.forEach((videoId) => {
          if (!resultVideoIds.includes(videoId)) {
            resultVideoIds.push(videoId);
          }

          const channelIds = ensureMap(videoIdChannelIds, videoId, []);
          if (!channelIds.includes(channelId)) {
            channelIds.push(channelId);
          }
        });
      }, (err) => {
        debug(`getVideoIds for channel (%s) skip, cause: %o`, channelId, err);
        resultSkippedChannelIds.push(channelId);
      });
    }).then(() => {
      return {
        videoIds: resultVideoIds,
        videoIdChannelIds: videoIdChannelIds,
        skippedChannelIds: resultSkippedChannelIds,
      };
    });
  }

  getExistsChannelIds(ids) {
    const resultChannelIds = [];
    return parallel(10, arrayByPart(ids, 50), (ids) => {
      return iterPages((pageToken) => {
        return gotLimited('https://www.googleapis.com/youtube/v3/channels', {
          query: {
            part: 'id',
            id: ids.join(','),
            pageToken: pageToken,
            maxResults: 50,
            fields: 'items/id,nextPageToken',
            key: this.main.config.ytToken
          },
          json: true,
        }).then(({body}) => {
          const channelsItemsId = ChannelsItemsId(body);
          channelsItemsId.items.forEach((item) => {
            resultChannelIds.push(item.id);
          });

          return channelsItemsId.nextPageToken;
        });
      });
    }).then(() => resultChannelIds);
  }

  async requestChannelIdByQuery(query) {
    if (!query) {
      throw new ErrorWithCode('Query is empty', 'QUERY_IS_EMPTY')
    }

    return gotLimited('https://www.googleapis.com/youtube/v3/search', {
      query: {
        part: 'snippet',
        q: query,
        type: 'channel',
        maxResults: 1,
        fields: 'items(id)',
        key: this.main.config.ytToken
      },
      json: true,
    }).then(({body}) => {
      const searchItemsId = SearchItemsId(body);
      if (!searchItemsId.items.length) {
        throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
      }

      return searchItemsId.items[0].id.channelId;
    });
  }

  async requestChannelIdByUserUrl(url) {
    let username = null;
    [
      /youtube\.com\/(?:#\/)?user\/([\w\-]+)/i,
      /youtube\.com\/([\w\-]+)/i
    ].some((re) => {
      const m = re.exec(url);
      if (m) {
        username = m[1];
        return true;
      }
    });

    if (!username) {
      throw new ErrorWithCode('Is not user url', 'IS_NOT_USER_URL');
    }

    if (!/^[\w\-]+$/.test(username)) {
      throw new ErrorWithCode('Incorrect username', 'INCORRECT_USERNAME');
    }

    return gotLimited('https://www.googleapis.com/youtube/v3/channels', {
      query: {
        part: 'snippet',
        forUsername: username,
        maxResults: 1,
        fields: 'items/id',
        key: this.main.config.ytToken
      },
      json: true,
    }).then(({body}) => {
      const channelsItemsId = ChannelsItemsId(body);
      if (!channelsItemsId.items.length) {
        throw new ErrorWithCode('Channel by user is not found', 'CHANNEL_BY_USER_IS_NOT_FOUND');
      }

      return channelsItemsId.items[0].id;
    });
  }

  async requestChannelIdByVideoUrl(url) {
    let videoId = null;
    [
      /youtu\.be\/([\w\-]+)/i,
      /youtube\.com\/.+[?&]v=([\w\-]+)/i,
      /youtube\.com\/(?:.+\/)?(?:v|embed)\/([\w\-]+)/i
    ].some((re) => {
      const m = re.exec(url);
      if (m) {
        videoId = m[1];
        return true;
      }
    });

    if (!videoId) {
      throw new ErrorWithCode('Is not video url', 'IS_NOT_VIDEO_URL');
    }

    return gotLimited('https://www.googleapis.com/youtube/v3/videos', {
      query: {
        part: 'snippet',
        id: videoId,
        maxResults: 1,
        fields: 'items/snippet',
        key: this.main.config.ytToken
      },
      json: true,
    }).then(({body}) => {
      const videosItemsSnippet = VideosItemsSnippet(body);
      if (!videosItemsSnippet.items.length) {
        throw new ErrorWithCode('Video by id is not found', 'CHANNEL_BY_VIDEO_ID_IS_NOT_FOUND');
      }

      return videosItemsSnippet.items[0].snippet.channelId;
    });
  }

  async getChannelIdByUrl(url) {
    let channelId = null;
    [
      /youtube\.com\/(?:#\/)?channel\/([\w\-]+)/i
    ].some((re) => {
      const m = re.exec(url);
      if (m) {
        channelId = m[1];
        return true;
      }
    });

    if (!channelId) {
      throw new ErrorWithCode('Is not channel url', 'IS_NOT_CHANNEL_URL');
    }

    if (!/^UC/.test(channelId)) {
      throw new ErrorWithCode('Incorrect channel id', 'INCORRECT_CHANNEL_ID');
    }

    return channelId;
  }

  findChannel(query) {
    return this.getChannelIdByUrl(query).catch((err) => {
      if (err.code === 'IS_NOT_CHANNEL_URL') {
        return this.requestChannelIdByVideoUrl(query);
      }
      throw err;
    }).catch((err) => {
      if (err.code === 'IS_NOT_VIDEO_URL') {
        return this.requestChannelIdByUserUrl(query);
      }
      throw err;
    }).catch((err) => {
      if (err.code === 'IS_NOT_USER_URL') {
        return this.requestChannelIdByQuery(query);
      }
      throw err;
    }).then((channelId) => {
      return gotLimited('https://www.googleapis.com/youtube/v3/search', {
        query: {
          part: 'snippet',
          channelId: channelId,
          maxResults: 1,
          fields: 'items/snippet',
          key: this.main.config.ytToken
        },
        json: true,
      }).then(({body}) => {
        const searchItemsSnippet = SearchItemsSnippet(body);
        if (!searchItemsSnippet.items.length) {
          throw new ErrorWithCode('Channel is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
        }

        const snippet = searchItemsSnippet.items[0].snippet;
        const title = snippet.channelTitle;
        const id = snippet.channelId;
        const url = getChannelUrl(id);
        return {id, title, url};
      });
    });
  }
}

function getVideoUrl(videoId) {
  return 'https://youtu.be/' + encodeURIComponent(videoId);
}

function getChannelUrl(channelId) {
  return 'https://youtube.com/channel/' + encodeURIComponent(channelId);
}

function isDailyLimitExceeded(err) {
  if (err.name === 'HTTPError' && err.statusCode === 403 && err.body && err.body.error && err.body.error.code === 403 && /Daily Limit Exceeded/.test(err.body.error.message)) {
    return true;
  }
  return false;
}

function iterPages(callback) {
  let limit = 100;
  const getPage = (pageToken) => {
    return promiseTry(() => callback(pageToken)).then((nextPageToken) => {
      if (nextPageToken) {
        if (--limit < 0) {
          throw new ErrorWithCode(`Page limit reached`, 'PAGE_LIMIT_REACHED');
        }
        return getPage(nextPageToken);
      }
    });
  };
  return getPage();
}

export default Youtube;