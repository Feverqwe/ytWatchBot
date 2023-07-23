import arrayDifference from './tools/arrayDifference';
import LogFile from './logFile';
import getInProgress from './tools/getInProgress';
import ensureMap from './tools/ensureMap';
import serviceId from './tools/serviceId';
import parallel from './tools/parallel';
import {everyMinutes} from './tools/everyTime';
import promiseLimit from './tools/promiseLimit';
import Main from './main';
import {ChannelModel, NewChannel, NewChatIdVideoId, NewVideo} from './db';
import {appConfig} from './appConfig';
import {getDebug} from './tools/getDebug';

const debug = getDebug('app:Checker');

export type FilterFn = (videoIds: string[]) => Promise<string[]>;

export interface ServiceInterface {
  id: string;
  name: string;
  getVideos(
    channels: RawChannel[],
    filterFn: FilterFn,
  ): Promise<{
    videos: RawVideo[];
    videoIdChannelIds: Map<string, string[]>;
    skippedChannelIds: string[];
  }>;
  getExistsChannelIds(channelsIds: string[]): Promise<string[]>;
  findChannel(query: string): Promise<ServiceChannel>;
}

export interface ServiceChannel {
  id: string;
  url: string;
  title: string;
}

export interface RawChannel {
  id: string;
  publishedAfter: Date;
}

export type RawVideo = NewVideo & {
  channelTitle: string;
};

class Checker {
  log: LogFile;
  readonly oneLimit: ReturnType<typeof promiseLimit>;
  constructor(private main: Main) {
    this.log = new LogFile('checker');
    this.oneLimit = promiseLimit(1);
  }

  init() {
    this.startUpdateInterval();
    this.startCleanInterval();
  }

  updateTimer: (() => void) | null = null;
  startUpdateInterval() {
    this.updateTimer && this.updateTimer();
    this.updateTimer = everyMinutes(appConfig.emitCheckChannelsEveryMinutes, async () => {
      try {
        await this.check();
      } catch (err) {
        debug('check error', err);
      }
    });
  }

  cleanTimer: (() => void) | null = null;
  startCleanInterval() {
    this.cleanTimer && this.cleanTimer();
    this.cleanTimer = everyMinutes(appConfig.emitCleanChatsAndVideosEveryHours * 60, async () => {
      try {
        await this.clean();
      } catch (err) {
        debug('clean error', err);
      }
    });
  }

  inProgress = getInProgress();

  getDefaultDate() {
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() - appConfig.fullCheckChannelActivityForDays);
    return defaultDate;
  }

  check = () => {
    return this.inProgress(() =>
      this.oneLimit(async () => {
        const results = [];
        while (true) {
          const channels = await this.main.db.getChannelsForSync(50);
          if (!channels.length) {
            break;
          }

          const channelIdChannel = new Map<string, ChannelModel>();
          const channelIds: string[] = [];
          const rawChannels: RawChannel[] = [];
          const channelIdIsFullCheck = new Map<string, Date>();

          const defaultDate = this.getDefaultDate();
          const minFullCheckDate = new Date();
          minFullCheckDate.setHours(
            minFullCheckDate.getHours() - appConfig.doFullCheckChannelActivityEveryHours,
          );

          channels.forEach((channel) => {
            channelIds.push(channel.id);
            channelIdChannel.set(channel.id, channel);

            let publishedAfter = null;
            if (channel.lastVideoPublishedAt) {
              publishedAfter = new Date(channel.lastVideoPublishedAt.getTime() + 1000);
            }
            if (!publishedAfter || publishedAfter.getTime() < defaultDate.getTime()) {
              publishedAfter = defaultDate;
            }
            if (channel.lastFullSyncAt.getTime() < minFullCheckDate.getTime()) {
              channelIdIsFullCheck.set(channel.id, publishedAfter);
              publishedAfter = defaultDate;
            }

            rawChannels.push({
              id: serviceId.unwrap(channel.id),
              publishedAfter: publishedAfter,
            });
          });

          const syncAt = new Date();
          await this.main.db.setChannelsSyncTimeoutExpiresAtAndUncheckChanges(channelIds);

          const filterFn = (rawVideoIds: string[]) => {
            const videoIds = rawVideoIds.map((id) => serviceId.wrap(this.main.youtube, id));
            return this.main.db.getExistsVideoIds(videoIds).then((existsVideoIds) => {
              return arrayDifference(videoIds, existsVideoIds).map((id) => serviceId.unwrap(id));
            });
          };

          const {
            videos: rawVideos,
            videoIdChannelIds: rawVideoIdRawChannelIds,
            skippedChannelIds: skippedRawChannelIds,
          } = await this.main.youtube.getVideos(rawChannels, filterFn);

          const videoIdVideo = new Map<string, RawVideo>();
          const videoIds: string[] = [];

          const checkedChannelIds = channelIds.slice(0);
          skippedRawChannelIds.forEach((rawId) => {
            const id = serviceId.wrap(this.main.youtube, rawId);
            const pos = checkedChannelIds.indexOf(id);
            if (pos !== -1) {
              checkedChannelIds.splice(pos, 1);
            }
          });

          rawVideos.forEach((rawVideo) => {
            const rawChannelIds = rawVideoIdRawChannelIds.get(rawVideo.id)!;
            rawChannelIds.forEach((rawChannelId) => {
              const video = Object.assign({}, rawVideo);

              if (video.channelId !== rawChannelId) {
                video.mergedId = serviceId.wrap(this.main.youtube, video.id);
                video.mergedChannelId = serviceId.wrap(this.main.youtube, video.channelId);
                video.id = `${video.id}@${rawChannelId}`;
                video.channelId = rawChannelId;
              }

              video.id = serviceId.wrap(this.main.youtube, video.id);
              video.channelId = serviceId.wrap(this.main.youtube, video.channelId);

              if (!checkedChannelIds.includes(video.channelId)) {
                debug('Video %s skip, cause: Channel %s is not exists', video.id, video.channelId);
                return;
              }

              videoIdVideo.set(video.id, video);
              videoIds.push(video.id);
            });
          });

          const existsVideoIds = await this.main.db.getExistsVideoIds(videoIds);
          const videos = arrayDifference(videoIds, existsVideoIds).map(
            (id) => videoIdVideo.get(id)!,
          );

          const channelIdsChanges: Record<string, NewChannel> = {};
          const channelIdVideoIds = new Map<string, string[]>();

          checkedChannelIds.forEach((id) => {
            const channel = channelIdChannel.get(id)!;
            const changes: Partial<NewChannel> = {
              lastSyncAt: syncAt,
            };
            if (channelIdIsFullCheck.has(id)) {
              changes.lastFullSyncAt = syncAt;
            }
            channelIdsChanges[id] = Object.assign({}, channel.get({plain: true}), changes);
          });

          videos.forEach((video) => {
            const channel = channelIdChannel.get(video.channelId)!;
            const channelChanges = channelIdsChanges[channel.id];

            const title = channelChanges.title || channel.title;
            if (!video.mergedId && title !== video.channelTitle) {
              channelChanges.title = video.channelTitle;
            }

            const lastVideoPublishedAt =
              channelChanges.lastVideoPublishedAt || channel.lastVideoPublishedAt;
            if (
              !lastVideoPublishedAt ||
              lastVideoPublishedAt.getTime() < video.publishedAt.getTime()
            ) {
              channelChanges.lastVideoPublishedAt = video.publishedAt;
            }

            const channelVideoIds = ensureMap(channelIdVideoIds, video.channelId, []);
            channelVideoIds.push(video.id);
          });

          const chatIdChannelIdList = await this.main.db.getChatIdChannelIdByChannelIds(
            checkedChannelIds,
          );
          const channelIdChats = new Map<string, {chatId: string; createdAt: Date}[]>();
          chatIdChannelIdList.forEach((chatIdChannelId) => {
            const chats = ensureMap(channelIdChats, chatIdChannelId.channelId, []);
            if (!chatIdChannelId.chat.channelId || !chatIdChannelId.chat.isMuted) {
              chats.push({
                chatId: chatIdChannelId.chat.id,
                createdAt: chatIdChannelId.createdAt,
              });
            }
            if (chatIdChannelId.chat.channelId) {
              chats.push({
                chatId: chatIdChannelId.chat.channelId,
                createdAt: chatIdChannelId.createdAt,
              });
            }
          });

          const minPublishedAfter = new Date();
          minPublishedAfter.setDate(
            minPublishedAfter.getDate() - appConfig.cleanVideosIfPublishedOlderThanDays,
          );

          const chatIdVideoIdChanges: NewChatIdVideoId[] = [];
          for (const [channelId, chats] of channelIdChats.entries()) {
            const videoIds = channelIdVideoIds.get(channelId);
            if (videoIds) {
              videoIds.forEach((videoId) => {
                const video = videoIdVideo.get(videoId)!;
                chats.forEach(({chatId, createdAt}) => {
                  if (
                    video.publishedAt.getTime() > minPublishedAfter.getTime() &&
                    video.publishedAt.getTime() > createdAt.getTime()
                  ) {
                    chatIdVideoIdChanges.push({chatId, videoId});
                  }
                });
              });
            }
          }

          const channelsChanges = Object.values(channelIdsChanges);
          await this.main.db.putVideos(channelsChanges, videos, chatIdVideoIdChanges);

          videos.forEach((video) => {
            let type;
            if (channelIdIsFullCheck.has(video.channelId)) {
              const publishedAfter = channelIdIsFullCheck.get(video.channelId)!;
              if (video.publishedAt.getTime() >= publishedAfter.getTime()) {
                type = 'insert as full';
              } else {
                type = 'insert full';
              }
            } else {
              type = 'insert';
            }
            this.log.write(`[${type}] ${video.channelId} ${video.id}`);
          });

          if (videos.length) {
            this.main.sender.checkThrottled();
          }

          results.push({
            channelsChangesCount: channelsChanges.length,
            videosCount: videos.length,
            chatIdVideoIdChangesCount: chatIdVideoIdChanges.length,
          });
        }
        return results;
      }),
    );
  };

  checkChannelsExistsInProgress = getInProgress();
  checkChannelsExists = () => {
    return this.checkChannelsExistsInProgress(async () => {
      return parallel(1, this.main.services, async (service) => {
        const result = {
          id: service.id,
          channelCount: 0,
          removedCount: 0,
        };

        let limit = 500;
        let offset = 0;
        while (true) {
          const channelIds = await this.main.db.getChannelIdsByServiceId(service.id, offset, limit);
          offset += limit;
          if (!channelIds.length) break;
          result.channelCount += channelIds.length;

          const existsRawChannelIds = await service.getExistsChannelIds(
            channelIds.map((id) => serviceId.unwrap(id)),
          );

          const existsChannelIds = existsRawChannelIds.map((id) => serviceId.wrap(service, id));
          const removedChannelIds = arrayDifference(channelIds, existsChannelIds);
          await this.main.db.removeChannelByIds(removedChannelIds);

          result.removedCount += removedChannelIds.length;
          offset -= removedChannelIds.length;
        }

        return result;
      });
    });
  };

  clean = () => {
    return this.oneLimit(async () => {
      const [[removedChats, removedChannels], removedVideos] = await Promise.all([
        (async () => {
          const chatsCount = await this.main.db.cleanChats();
          const channelsCount = await this.main.db.cleanChannels();
          return [chatsCount, channelsCount];
        })(),
        this.main.db.cleanVideos(),
      ]);
      return {removedChats, removedChannels, removedVideos};
    });
  };
}

export default Checker;
