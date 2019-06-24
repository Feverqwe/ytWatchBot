import ErrorWithCode from "../tools/errorWithCode";
import {struct} from "superstruct";
import RateLimit from "../tools/rateLimit";
import arrayByPart from "../tools/arrayByPart";
import parallel from "../tools/parallel";
import formatDuration from "../tools/formatDuration";
import withRetry from "../tools/withRetry";

const debug = require('debug')('app:Youtube');
const got = require('got');

const rateLimit = new RateLimit(1000);
const gotLimited = rateLimit.wrap(got);

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
  })]
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
    nextPageToken: 'string?'
  })]
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
    nextPageToken: 'string?'
  })]
});

class Youtube {
  constructor(/**Main*/main) {
    this.main = main;
    this.name = 'Youtube';
  }

  getVideos(channels) {
    return this.getVideoIds(channels).then(({videoIds, skippedChannelIds}) => {
      return this.getVideosByIds(videoIds).then((videos) => {
        return {videos, skippedChannelIds};
      });
    });
  }

  getVideosByIds(videoIds) {
    const resultVideos = [];
    return parallel(10, arrayByPart(videoIds, 50), (videoIds) => {
      let pageLimit = 100;
      const getPage = (pageToken) => {
        return withRetry({count: 3, timeout: 250}, () => {
          return gotLimited('https://www.googleapis.com/youtube/v3/videos', {
            query: {
              part: 'snippet,contentDetails',
              id: videoIds.join(','),
              pageToken: pageToken,
              fields: 'items/id,items/snippet,items/contentDetails,nextPageToken',
              key: this.main.config.ytToken
            },
            json: true,
          });
        }, isDailyLimitExceeded).then(({body}) => {
          const videos = VideosResponse(body);

          videos.items.forEach((video) => {
            const previews = Object.values(video.snippet.thumbnails).sort((a, b) => {
              return a.width > b.width ? -1 : 1;
            }).map(thumbnail => thumbnail.url);

            let duration = null;
            try {
              duration = formatDuration(video.contentDetails.duration);
            } catch (err) {
              debug('formatDuration %s error', video.id, err);
            }

            const result = {
              id: video.id,
              title: video.snippet.title,
              previews: previews,
              duration: duration,
              channelId: video.snippet.channelId,
              channelTitle: video.snippet.channelTitle,
              publishedAt: new Date(video.snippet.publishedAt),
            };

            resultVideos.push(result);
          });

          if (videos.nextPageToken) {
            if (--pageLimit < 0) {
              throw new ErrorWithCode(`Page limit reached `, 'PAGE_LIMIT_REACHED');
            }
            return getPage(videos.nextPageToken);
          }
        });
      };
      return getPage();
    }).then(() => resultVideos);
  }

  getVideoIds(channels) {
    const resultSkippedChannelIds = [];
    const resultVideoIds = [];
    return parallel(10, channels, ({id: channelId, publishedAfter}) => {
      let pageLimit = 100;
      const getPage = (pageToken) => {
        return withRetry({count: 3, timeout: 250}, () => {
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
          });
        }, isDailyLimitExceeded).then(({body}) => {
          const activities = ActivitiesResponse(body);
          activities.items.forEach((item) => {
            const videoId = item.contentDetails.upload.videoId;
            resultVideoIds.push(videoId);
          });

          if (activities.nextPageToken) {
            if (--pageLimit < 0) {
              throw new ErrorWithCode(`Page limit reached ${channelId}`, 'PAGE_LIMIT_REACHED');
            }
            return getPage(activities.nextPageToken);
          }
        });
      };
      return getPage().catch((err) => {
        debug(`getVideoIds for channel (%s) skip, cause: error %o`, channelId, err);
        resultSkippedChannelIds.push(channelId);
      });
    }).then(() => {
      return {
        videoIds: resultVideoIds,
        skippedChannelIds: resultSkippedChannelIds
      };
    });
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
      return new ErrorWithCode('Incorrect username', 'INCORRECT_USERNAME');
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
          throw new ErrorWithCode('Channel is not found', 'CHANNEL_IS_NOT_FOUND');
        }

        const snippet = searchItemsSnippet.items[0].snippet;
        const name = snippet.channelTitle;
        const id = snippet.channelId;
        const url = getChannelUrl(channelId);
        return {id, name, url};
      });
    });
  }
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

export default Youtube;