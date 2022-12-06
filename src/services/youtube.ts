import ErrorWithCode from "../tools/errorWithCode";
import * as s from "superstruct";
import arrayByPart from "../tools/arrayByPart";
import parallel from "../tools/parallel";
import formatDuration from "../tools/formatDuration";
import ensureMap from "../tools/ensureMap";
import promiseTry from "../tools/promiseTry";
import fetchRequest, {HTTPError} from "../tools/fetchRequest";
import {FilterFn, RawChannel, RawVideo, ServiceInterface} from "../checker";
import Main from "../main";
import ytCostCounter from "../tools/ytCostCounter";

const debug = require('debug')('app:Youtube');

const costCounter = ytCostCounter(150000);

const VideosItemsSnippetStruct = s.object({
  items: s.array(s.object({
    snippet: s.object({
      channelId: s.string()
    })
  }))
});

const ChannelsItemsIdStruct = s.object({
  items: s.optional(s.array(s.object({
    id: s.string()
  }))),
  nextPageToken: s.optional(s.string())
});

const SearchItemsIdStruct = s.object({
  items: s.array(s.object({
    id: s.object({
      channelId: s.string()
    })
  }))
});

const SearchItemsSnippetStruct = s.object({
  items: s.array(s.object({
    snippet: s.object({
      channelId: s.string(),
      channelTitle: s.string()
    })
  }))
});

const ActivitiesResponseStruct = s.object({
  items: s.array(s.object({
    contentDetails: s.object({
      upload: s.optional(s.object({
        videoId: s.string()
      })),
    }),
  })),
  nextPageToken: s.optional(s.string())
});

const VideosResponseStruct = s.object({
  items: s.array(s.object({
    id: s.string(),
    snippet: s.object({
      publishedAt: s.string(), // 2007-03-05T08:22:25.000Z
      channelId: s.string(),
      title: s.string(),
      // description: s.string(),
      thumbnails: s.record(s.string(), s.object({
        url: s.string(),
        width: s.number(),
        height: s.number(),
      })),
      channelTitle: s.string(),
      // tags: [s.string()],
      // categoryId: s.string(), // 10
      liveBroadcastContent: s.string(), // live none upcoming
      // localized: s.object({
      //   title: s.string(),
      //   description: s.string(),
      // })
    }),
    contentDetails: s.object({
      duration: s.string(), // PT2M57S
      // dimension: s.string(), // 2d
      // definition: s.string(), // sd
      // caption: s.string(), // false
      // licensedContent: 'boolean', // true
      // projection: s.string(), // rectangular
    }),
  })),
  nextPageToken: s.optional(s.string())
});

const FineChannelByVideoIdResponseStruct = s.object({
  items: s.array(s.object({
    snippet: s.object({
      channelId: s.string(),
      channelTitle: s.string(),
    }),
  })),
});

class Youtube implements ServiceInterface {
  id = 'youtube';
  name = 'Youtube';

  constructor(private main: Main) {}

  getVideos(channels: RawChannel[], filterFn: FilterFn) {
    return this.getVideoIds(channels).then(({videoIds, videoIdChannelIds, skippedChannelIds}) => {
      return filterFn(videoIds).then((videoIds) => {
        return this.getVideosByIds(videoIds);
      }).then((videos) => {
        return {videos, videoIdChannelIds, skippedChannelIds};
      });
    });
  }

  getVideosByIds(videoIds: string[]) {
    const resultVideos: RawVideo[] = [];
    return tryFixBackendError(25, (maxResults = 50) => {
      resultVideos.splice(0);
      return parallel(10, arrayByPart(videoIds, maxResults), (videoIds) => {
        return iterPages(async (pageToken) => {
          await costCounter.inc(1);
          return fetchRequest('https://www.googleapis.com/youtube/v3/videos', {
            searchParams: {
              part: 'snippet,contentDetails',
              id: videoIds.join(','),
              pageToken: pageToken,
              fields: 'items/id,items/snippet,items/contentDetails,nextPageToken',
              key: this.main.config.ytToken
            },
            responseType: 'json',
            keepAlive: true,
          }).then(({body}) => {
            const videos = s.mask(body, VideosResponseStruct);

            videos.items.forEach((video) => {
              if (video.snippet.liveBroadcastContent !== 'none') return;

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
      });
    }).then(() => resultVideos);
  }

  getVideoIds(channels: RawChannel[]) {
    const resultSkippedChannelIds: string[] = [];
    const videoIdChannelIds = new Map<string, string[]>();
    const resultVideoIds: string[] = [];
    return parallel(10, channels, ({id: channelId, publishedAfter}) => {
      const videoIds: string[] = [];
      return tryFixBackendError(25, (maxResults = 50) => {
        videoIds.splice(0);
        return iterPages(async (pageToken) => {
          await costCounter.inc(1);
          return fetchRequest('https://www.googleapis.com/youtube/v3/activities', {
            searchParams: {
              part: 'contentDetails',
              channelId: channelId,
              maxResults,
              pageToken: pageToken,
              fields: 'items/contentDetails/upload/videoId,nextPageToken',
              publishedAfter: publishedAfter.toISOString(),
              key: this.main.config.ytToken
            },
            responseType: 'json',
            keepAlive: true,
          }).then(({body}) => {
            const activities = s.mask(body, ActivitiesResponseStruct);
            activities.items.forEach((item) => {
              if (!item.contentDetails.upload) return;
              const videoId = item.contentDetails.upload.videoId;
              videoIds.push(videoId);
            });

            return activities.nextPageToken;
          });
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

  getExistsChannelIds(ids: string[]) {
    const resultChannelIds: string[] = [];
    return parallel(10, arrayByPart(ids, 50), (ids) => {
      return iterPages(async (pageToken) => {
        await costCounter.inc(1);
        return fetchRequest('https://www.googleapis.com/youtube/v3/channels', {
          searchParams: {
            part: 'id',
            id: ids.join(','),
            pageToken: pageToken,
            maxResults: 50,
            fields: 'items/id,nextPageToken',
            key: this.main.config.ytToken
          },
          responseType: 'json',
          keepAlive: true,
        }).then(({body}) => {
          const channelsItemsId = s.mask(body, ChannelsItemsIdStruct);
          if (channelsItemsId.items) {
            channelsItemsId.items.forEach((item) => {
              resultChannelIds.push(item.id);
            });
          }

          return channelsItemsId.nextPageToken;
        });
      });
    }).then(() => resultChannelIds);
  }

  async requestChannelIdByQuery(query: string) {
    if (!query) {
      throw new ErrorWithCode('Query is empty', 'QUERY_IS_EMPTY')
    }

    await costCounter.inc(100);
    return fetchRequest('https://www.googleapis.com/youtube/v3/search', {
      searchParams: {
        part: 'snippet',
        q: query,
        type: 'channel',
        maxResults: 1,
        fields: 'items(id)',
        key: this.main.config.ytToken
      },
      responseType: 'json',
      keepAlive: true,
    }).then(({body}) => {
      const searchItemsId = s.mask(body, SearchItemsIdStruct);
      if (!searchItemsId.items.length) {
        throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
      }

      return searchItemsId.items[0].id.channelId;
    });
  }

  async requestChannelIdByUserUrl(url: string) {
    let username = '';
    [
      /youtube\.com\/(?:#\/)?user\/([\w\-]+)/i,
      /youtube\.com\/c\/([\w\-]+)/i,
      /youtube\.com\/([\w\-]+)/i,
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

    await costCounter.inc(1);
    return fetchRequest('https://www.googleapis.com/youtube/v3/channels', {
      searchParams: {
        part: 'snippet',
        forUsername: username,
        maxResults: 1,
        fields: 'items/id',
        key: this.main.config.ytToken
      },
      responseType: 'json',
      keepAlive: true,
    }).then(({body}) => {
      const channelsItemsId = s.mask(body, ChannelsItemsIdStruct);
      if (!channelsItemsId.items || !channelsItemsId.items.length) {
        throw new ErrorWithCode('Channel by user is not found', 'CHANNEL_BY_USER_IS_NOT_FOUND');
      }

      return channelsItemsId.items[0].id;
    }).catch((err) => {
      if (err.code === 'CHANNEL_BY_USER_IS_NOT_FOUND') {
        return this.requestChannelIdByQuery(username);
      }
      throw err;
    });
  }

  async requestChannelIdByVideoUrl(url: string) {
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

    await costCounter.inc(1);
    return fetchRequest('https://www.googleapis.com/youtube/v3/videos', {
      searchParams: {
        part: 'snippet',
        id: videoId,
        maxResults: 1,
        fields: 'items/snippet',
        key: this.main.config.ytToken
      },
      responseType: 'json',
      keepAlive: true,
    }).then(({body}) => {
      const videosItemsSnippet = s.mask(body, VideosItemsSnippetStruct);
      if (!videosItemsSnippet.items.length) {
        throw new ErrorWithCode('Video by id is not found', 'CHANNEL_BY_VIDEO_ID_IS_NOT_FOUND');
      }

      return videosItemsSnippet.items[0].snippet.channelId;
    });
  }

  async getChannelIdByUrl(url: string) {
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

    return this.getExistsChannelIds([channelId]).then((channelIds) => {
      if (!channelIds.length) {
        throw new ErrorWithCode('Incorrect channel id', 'INCORRECT_CHANNEL_ID');
      }
      return channelIds[0];
    });
  }

  findChannel(query: string) {
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
    }).then(async (channelId) => {
      await costCounter.inc(1);
      return fetchRequest('https://www.googleapis.com/youtube/v3/activities', {
        searchParams: {
          part: 'contentDetails',
          channelId: channelId,
          maxResults: 50,
          fields: 'items/contentDetails/upload/videoId',
          key: this.main.config.ytToken
        },
        responseType: 'json',
        keepAlive: true,
      }).then(({body}) => {
        const activities = s.mask(body, ActivitiesResponseStruct);
        let videoId = null;
        activities.items.some((item) => {
          if (!item.contentDetails.upload) return;
          return videoId = item.contentDetails.upload.videoId;
        });
        if (!videoId) {
          throw new ErrorWithCode(`Can't find any videos`, 'VIDEOS_IS_NOT_FOUND');
        }
        return videoId;
      });
    }).then(async (videoId) => {
      await costCounter.inc(1);
      return fetchRequest('https://www.googleapis.com/youtube/v3/videos', {
        searchParams: {
          part: 'snippet',
          id: videoId,
          fields: 'items/snippet',
          key: this.main.config.ytToken
        },
        responseType: 'json',
        keepAlive: true,
      }).then(({body}) => {
        const searchItemsSnippet = s.mask(body, FineChannelByVideoIdResponseStruct);
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

function getVideoUrl(videoId: string) {
  return 'https://youtu.be/' + encodeURIComponent(videoId);
}

function getChannelUrl(channelId: string) {
  return 'https://youtube.com/channel/' + encodeURIComponent(channelId);
}

function isDailyLimitExceeded(err: HTTPError) {
  if (err.name === 'HTTPError' && err.response.statusCode === 403 && err.response.body && err.response.body.error && err.response.body.error.code === 403 && /Daily Limit Exceeded/.test(err.response.body.error.message)) {
    return true;
  }
  return false;
}

function isBackendError(err: HTTPError) {
  if (err.name === 'HTTPError' && err.response.statusCode === 500 && err.response.body && err.response.body.error && err.response.body.error.code === 500 && /Backend Error/.test(err.response.body.error.message)) {
    return true;
  }
  return false;
}

function iterPages(callback: (pageToken?: string) => Promise<string|undefined>) {
  let limit = 100;
  const getPage = (pageToken?: string): Promise<void> => {
    return promiseTry(() => callback(pageToken)).then((nextPageToken?: string) => {
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

function tryFixBackendError<T>(fixMaxResults: number, callback: (maxResults?: number) => Promise<T>) {
  return callback().catch((err) => {
    if (isBackendError(err)) {
      debug('tryFixBackendError backendError: %o', err);
      return callback(fixMaxResults);
    }
    throw err;
  });
}

export default Youtube;
