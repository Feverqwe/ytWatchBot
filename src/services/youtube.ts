import ErrorWithCode from '../shared/tools/errorWithCode';
import * as v from 'valibot';
import arrayByPart from '../shared/tools/arrayByPart';
import parallel from '../shared/tools/parallel';
import formatDuration from '../tools/formatDuration';
import ensureMap from '../shared/tools/ensureMap';
import fetchRequest, {HTTPError} from '../shared/tools/fetchRequest';
import {FilterFn, RawChannel, RawVideo, ServiceInterface} from '../checker';
import Main from '../main';
import ytCostCounter from '../shared/tools/ytCostCounter';
import {appConfig} from '../appConfig';
import {getDebug} from '../shared/tools/getDebug';

const debug = getDebug('app:Youtube');

const costCounter = ytCostCounter(150000);

const VideosItemsSnippetSchema = v.object({
  items: v.array(
    v.object({
      snippet: v.object({
        channelId: v.string(),
      }),
    }),
  ),
});

const ChannelsItemsIdSchema = v.object({
  items: v.optional(
    v.array(
      v.object({
        id: v.string(),
      }),
    ),
  ),
  nextPageToken: v.optional(v.string()),
});

const SearchItemsIdSchema = v.object({
  items: v.array(
    v.object({
      id: v.object({
        channelId: v.optional(v.string()),
      }),
    }),
  ),
});

const SearchItemsSnippetSchema = v.object({
  items: v.array(
    v.object({
      snippet: v.object({
        channelId: v.string(),
        channelTitle: v.string(),
      }),
    }),
  ),
});

const ActivitiesResponseSchema = v.object({
  items: v.array(
    v.object({
      contentDetails: v.object({
        upload: v.optional(
          v.object({
            videoId: v.string(),
          }),
        ),
      }),
    }),
  ),
  nextPageToken: v.optional(v.string()),
});

const VideosResponseSchema = v.object({
  items: v.array(
    v.object({
      id: v.string(),
      snippet: v.object({
        publishedAt: v.string(), // 2007-03-05T08:22:25.000Z
        channelId: v.string(),
        title: v.string(),
        // description: v.string(),
        thumbnails: v.record(
          v.string(),
          v.object({
            url: v.string(),
            width: v.number(),
            height: v.number(),
          }),
        ),
        channelTitle: v.string(),
        // tags: [v.string()],
        // categoryId: v.string(), // 10
        liveBroadcastContent: v.string(), // live none upcoming
        // localized: v.object({
        //   title: v.string(),
        //   description: v.string(),
        // })
      }),
      contentDetails: v.partial(
        v.object({
          duration: v.string(), // PT2M57S
          // dimension: v.string(), // 2d
          // definition: v.string(), // sd
          // caption: v.string(), // false
          // licensedContent: 'boolean', // true
          // projection: v.string(), // rectangular
        }),
      ),
    }),
  ),
  nextPageToken: v.optional(v.string()),
});

const FineChannelByVideoIdResponseSchema = v.object({
  items: v.array(
    v.object({
      snippet: v.object({
        channelId: v.string(),
        channelTitle: v.string(),
      }),
    }),
  ),
});

class Youtube implements ServiceInterface {
  id = 'youtube';
  name = 'Youtube';

  constructor(private main: Main) {}

  async getVideos(channels: RawChannel[], filterFn: FilterFn) {
    const {videoIds, videoIdChannelIds, skippedChannelIds} = await this.getVideoIds(channels);
    const fVideoIds = await filterFn(videoIds);
    const videos = await this.getVideosByIds(fVideoIds);
    return {videos, videoIdChannelIds, skippedChannelIds};
  }

  async getVideosByIds(videoIds: string[]) {
    const resultVideos: RawVideo[] = [];
    await tryFixBackendError(25, async (maxResults = 50) => {
      resultVideos.splice(0);
      await parallel(10, arrayByPart(videoIds, maxResults), async (videoIds) => {
        await iterPages(async (pageToken) => {
          await costCounter.inc(1);

          const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/videos', {
            searchParams: {
              part: 'snippet,contentDetails',
              id: videoIds.join(','),
              pageToken: pageToken,
              fields: 'items/id,items/snippet,items/contentDetails,nextPageToken',
              key: appConfig.ytToken,
            },
            responseType: 'json',
            keepAlive: true,
          });

          const videos = v.parse(VideosResponseSchema, body);

          videos.items.forEach((video) => {
            if (video.snippet.liveBroadcastContent !== 'none') return;

            const previews = Object.values(video.snippet.thumbnails)
              .sort((a, b) => {
                return a.width > b.width ? -1 : 1;
              })
              .map((thumbnail) => thumbnail.url);

            let duration = null;
            try {
              if (video.contentDetails.duration) {
                duration = formatDuration(video.contentDetails.duration);
              }
            } catch (err) {
              debug('formatDuration %s error %o', video.id, err);
            }

            const result = {
              id: video.id,
              url: getVideoUrl(video.id),
              title: video.snippet.title,
              previews: JSON.stringify(previews),
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
    return resultVideos;
  }

  async getVideoIds(channels: RawChannel[]) {
    const resultSkippedChannelIds: string[] = [];
    const videoIdChannelIds = new Map<string, string[]>();
    const resultVideoIds: string[] = [];
    await parallel(10, channels, async ({id: channelId, publishedAfter}) => {
      const videoIds: string[] = [];
      try {
        await tryFixBackendError(25, async (maxResults = 50) => {
          videoIds.splice(0);
          await iterPages(async (pageToken) => {
            await costCounter.inc(1);

            const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/activities', {
              searchParams: {
                part: 'contentDetails',
                channelId: channelId,
                maxResults,
                pageToken: pageToken,
                fields: 'items/contentDetails/upload/videoId,nextPageToken',
                publishedAfter: publishedAfter.toISOString(),
                key: appConfig.ytToken,
              },
              responseType: 'json',
              keepAlive: true,
            });

            const activities = v.parse(ActivitiesResponseSchema, body);
            activities.items.forEach((item) => {
              if (!item.contentDetails.upload) return;
              const videoId = item.contentDetails.upload.videoId;
              videoIds.push(videoId);
            });

            return activities.nextPageToken;
          });
        });

        videoIds.forEach((videoId) => {
          if (!resultVideoIds.includes(videoId)) {
            resultVideoIds.push(videoId);
          }

          const channelIds = ensureMap(videoIdChannelIds, videoId, []);
          if (!channelIds.includes(channelId)) {
            channelIds.push(channelId);
          }
        });
      } catch (err) {
        debug(`getVideoIds for channel (%s) skip, cause: %o`, channelId, err);
        resultSkippedChannelIds.push(channelId);
      }
    });

    return {
      videoIds: resultVideoIds,
      videoIdChannelIds: videoIdChannelIds,
      skippedChannelIds: resultSkippedChannelIds,
    };
  }

  async getExistsChannelIds(ids: string[]) {
    const resultChannelIds: string[] = [];
    await parallel(10, arrayByPart(ids, 50), async (ids) => {
      await iterPages(async (pageToken) => {
        await costCounter.inc(1);
        const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/channels', {
          searchParams: {
            part: 'id',
            id: ids.join(','),
            pageToken: pageToken,
            maxResults: 50,
            fields: 'items/id,nextPageToken',
            key: appConfig.ytToken,
          },
          responseType: 'json',
          keepAlive: true,
        });

        const channelsItemsId = v.parse(ChannelsItemsIdSchema, body);
        if (channelsItemsId.items) {
          channelsItemsId.items.forEach((item) => {
            resultChannelIds.push(item.id);
          });
        }

        return channelsItemsId.nextPageToken;
      });
    });
    return resultChannelIds;
  }

  async requestChannelIdByQuery(query: string) {
    if (!query) {
      throw new ErrorWithCode('Query is empty', 'QUERY_IS_EMPTY');
    }

    await costCounter.inc(100);

    const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/search', {
      searchParams: {
        part: 'snippet',
        q: query,
        type: 'channel',
        maxResults: 1,
        fields: 'items(id)',
        key: appConfig.ytToken,
      },
      responseType: 'json',
      keepAlive: true,
    });

    const searchItemsId = v.parse(SearchItemsIdSchema, body);
    let channelId: string | undefined;
    searchItemsId.items.some((item) => {
      if (item.id.channelId) {
        channelId = item.id.channelId;
        return true;
      }
      return false;
    });
    if (!channelId) {
      throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
    }

    return channelId;
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

    try {
      const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/channels', {
        searchParams: {
          part: 'snippet',
          forUsername: username,
          maxResults: 1,
          fields: 'items/id',
          key: appConfig.ytToken,
        },
        responseType: 'json',
        keepAlive: true,
      });

      const channelsItemsId = v.parse(ChannelsItemsIdSchema, body);
      if (!channelsItemsId.items || !channelsItemsId.items.length) {
        throw new ErrorWithCode('Channel by user is not found', 'CHANNEL_BY_USER_IS_NOT_FOUND');
      }

      return channelsItemsId.items[0].id;
    } catch (error) {
      const err = error as ErrorWithCode;
      if (err.code === 'CHANNEL_BY_USER_IS_NOT_FOUND') {
        return this.requestChannelIdByQuery(username);
      }
      throw err;
    }
  }

  async requestChannelIdByVideoUrl(url: string) {
    let videoId = null;
    [
      /youtu\.be\/([\w\-]+)/i,
      /youtube\.com\/.+[?&]v=([\w\-]+)/i,
      /youtube\.com\/(?:.+\/)?(?:v|embed)\/([\w\-]+)/i,
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
    const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/videos', {
      searchParams: {
        part: 'snippet',
        id: videoId,
        maxResults: 1,
        fields: 'items/snippet',
        key: appConfig.ytToken,
      },
      responseType: 'json',
      keepAlive: true,
    });

    const videosItemsSnippet = v.parse(VideosItemsSnippetSchema, body);
    if (!videosItemsSnippet.items.length) {
      throw new ErrorWithCode('Video by id is not found', 'CHANNEL_BY_VIDEO_ID_IS_NOT_FOUND');
    }

    return videosItemsSnippet.items[0].snippet.channelId;
  }

  async getChannelIdByUrl(url: string) {
    let channelId = null;
    [/youtube\.com\/(?:#\/)?channel\/([\w\-]+)/i].some((re) => {
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

    const channelIds = await this.getExistsChannelIds([channelId]);

    if (!channelIds.length) {
      throw new ErrorWithCode('Incorrect channel id', 'INCORRECT_CHANNEL_ID');
    }
    return channelIds[0];
  }

  async findChannel(query: string) {
    const channelId = await this.getChannelIdByUrl(query)
      .catch((err) => {
        if (err.code === 'IS_NOT_CHANNEL_URL') {
          return this.requestChannelIdByVideoUrl(query);
        }
        throw err;
      })
      .catch((err) => {
        if (err.code === 'IS_NOT_VIDEO_URL') {
          return this.requestChannelIdByUserUrl(query);
        }
        throw err;
      })
      .catch((err) => {
        if (err.code === 'IS_NOT_USER_URL') {
          return this.requestChannelIdByQuery(query);
        }
        throw err;
      });

    const videoId = await (async () => {
      await costCounter.inc(1);

      const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/activities', {
        searchParams: {
          part: 'contentDetails',
          channelId: channelId,
          maxResults: 50,
          fields: 'items/contentDetails/upload/videoId',
          key: appConfig.ytToken,
        },
        responseType: 'json',
        keepAlive: true,
      });

      const activities = v.parse(ActivitiesResponseSchema, body);
      let videoId = null;
      activities.items.some((item) => {
        if (!item.contentDetails.upload) return;
        videoId = item.contentDetails.upload.videoId;
        return videoId;
      });

      if (!videoId) {
        throw new ErrorWithCode(`Can't find any videos`, 'VIDEOS_IS_NOT_FOUND');
      }
      return videoId;
    })();

    await costCounter.inc(1);

    const {body} = await fetchRequest('https://www.googleapis.com/youtube/v3/videos', {
      searchParams: {
        part: 'snippet',
        id: videoId,
        fields: 'items/snippet',
        key: appConfig.ytToken,
      },
      responseType: 'json',
      keepAlive: true,
    });

    const searchItemsSnippet = v.parse(FineChannelByVideoIdResponseSchema, body);
    if (!searchItemsSnippet.items.length) {
      throw new ErrorWithCode('Channel is not found', 'CHANNEL_BY_ID_IS_NOT_FOUND');
    }

    const snippet = searchItemsSnippet.items[0].snippet;
    const title = snippet.channelTitle;
    const id = snippet.channelId;
    const url = getChannelUrl(id);
    return {id, title, url};
  }
}

function getVideoUrl(videoId: string) {
  return 'https://youtu.be/' + encodeURIComponent(videoId);
}

function getChannelUrl(channelId: string) {
  return 'https://youtube.com/channel/' + encodeURIComponent(channelId);
}

function isDailyLimitExceeded(err: HTTPError) {
  if (
    err.name === 'HTTPError' &&
    err.response.statusCode === 403 &&
    err.response.body &&
    err.response.body.error &&
    err.response.body.error.code === 403 &&
    /Daily Limit Exceeded/.test(err.response.body.error.message)
  ) {
    return true;
  }
  return false;
}

function isBackendError(err: HTTPError) {
  if (
    err.name === 'HTTPError' &&
    err.response.statusCode === 500 &&
    err.response.body &&
    err.response.body.error &&
    err.response.body.error.code === 500 &&
    /Backend Error/.test(err.response.body.error.message)
  ) {
    return true;
  }
  return false;
}

function iterPages(callback: (pageToken?: string) => Promise<string | undefined>) {
  let limit = 100;
  const getPage = async (pageToken?: string): Promise<void> => {
    const nextPageToken = await callback(pageToken);
    if (nextPageToken) {
      if (--limit < 0) {
        throw new ErrorWithCode(`Page limit reached`, 'PAGE_LIMIT_REACHED');
      }
      return getPage(nextPageToken);
    }
  };
  return getPage();
}

async function tryFixBackendError<T>(
  fixMaxResults: number,
  callback: (maxResults?: number) => Promise<T>,
) {
  try {
    return await callback();
  } catch (error) {
    const err = error as HTTPError;
    if (isBackendError(err)) {
      debug('tryFixBackendError backendError: %o', err);
      return callback(fixMaxResults);
    }
    throw err;
  }
}

export default Youtube;
