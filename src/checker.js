import arrayDifferent from "./tools/arrayDifferent";
import LogFile from "./logFile";
import roundStartInterval from "./tools/roundStartInterval";
import getInProgress from "./tools/getInProgress";
import ensureMap from "./tools/ensureMap";

const debug = require('debug')('app:Checker');
const promiseLimit = require('promise-limit');

class Checker {
  constructor(/**Main*/main) {
    this.main = main;
    this.log = new LogFile('checker');
    this.oneLimit = promiseLimit(1);
  }

  init() {
    this.startUpdateInterval();
    this.startCleanInterval();
  }

  updateIntervalId = null;
  startUpdateInterval() {
    clearInterval(this.updateIntervalId);
    this.updateIntervalId = roundStartInterval(() => {
      this.updateIntervalId = setInterval(() => {
        this.check();
      }, 5 * 60 * 1000);
      this.check();
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

  getDefaultDate() {
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() - 7);
    return defaultDate;
  }

  check() {
    return this.inProgress(() => this.oneLimit(async () => {
      while (true) {
        const channels = await this.main.db.getChannelsForSync(50);
        if (!channels.length) {
          break;
        }

        const channelIdChannel = new Map();
        const channelIds = [];
        const rawChannels = [];

        const defaultDate = this.getDefaultDate();

        channels.forEach(channel => {
          channelIds.push(channel.id);
          channelIdChannel.set(channel.id, channel);

          let publishedAfter = null;
          if (channel.lastVideoPublishedAt) {
            publishedAfter = new Date(channel.lastVideoPublishedAt.getTime() + 1000);
          }
          if (!publishedAfter) {
            publishedAfter = channel.lastSyncAt;
          }
          if (!publishedAfter || publishedAfter.getTime() < defaultDate.getTime()) {
            publishedAfter = defaultDate;
          }

          rawChannels.push({
            id: channel.rawId,
            publishedAfter: publishedAfter
          });
        });

        const syncAt = new Date();
        await this.main.db.setChannelsSyncTimeoutExpiresAtAndUncheckChanges(channelIds, 5).then(() => {
          return this.main.youtube.getVideos(rawChannels);
        }).then(({videos: rawVideos, videoIdChannelIds: rawVideoIdRawChannelIds, skippedChannelIds: skippedRawChannelIds}) => {
          const videoIdVideo = new Map();
          const videoIds = [];
          rawVideos.forEach((rawVideo) => {
            const rawChannelIds = rawVideoIdRawChannelIds.get(rawVideo.id);
            rawChannelIds.forEach((rawChannelId) => {
              const video = Object.assign({}, rawVideo);

              if (video.channelId !== rawChannelId) {
                video.mergedId = this.main.db.model.Channel.buildId('youtube', video.id);
                video.mergedChannelId = this.main.db.model.Channel.buildId('youtube', video.channelId);
                video.id = `${video.id}@${rawChannelId}`;
                video.channelId = rawChannelId;
              }

              video.id = this.main.db.model.Channel.buildId('youtube', video.id);
              video.channelId = this.main.db.model.Channel.buildId('youtube', video.channelId);

              if (!channelIdChannel.has(video.channelId)) {
                debug('Video %s skip, cause: Channel %s is not exists', video.id, video.channelId);
                return;
              }

              videoIdVideo.set(video.id, video);
              videoIds.push(video.id);
            });
          });

          const checkedChannelIds = channelIds.slice(0);
          skippedRawChannelIds.forEach((rawId) => {
            const id = this.main.db.model.Channel.buildId('youtube', rawId);
            const pos = checkedChannelIds.indexOf(id);
            if (pos !== -1) {
              checkedChannelIds.splice(pos, 1);
            }
          });

          return this.main.db.getExistsVideoIds(videoIds).then((existsVideoIds) => {
            const videos = arrayDifferent(videoIds, existsVideoIds).map(id => videoIdVideo.get(id));
            return {
              videos,
              videoIdVideo,
              channelIds: checkedChannelIds
            }
          });
        }).then(({videos, videoIdVideo, channelIds}) => {
          const channelIdsChanges = {};
          const channelIdVideoIds = new Map();

          channelIds.forEach((id) => {
            const channel = channelIdChannel.get(id);
            channelIdsChanges[id] = Object.assign({}, channel.get({plain: true}), {
              lastSyncAt: syncAt
            });
          });

          videos.forEach((video) => {
            const channel = channelIdChannel.get(video.channelId);
            const channelChanges = channelIdsChanges[channel.id];

            const title = channelChanges.title || channel.title;
            if (!video.mergedId && title !== video.channelTitle) {
              channelChanges.title = video.channelTitle;
            }

            const lastVideoPublishedAt = channelChanges.lastVideoPublishedAt || channel.lastVideoPublishedAt;
            if (!lastVideoPublishedAt || lastVideoPublishedAt.getTime() < video.publishedAt.getTime()) {
              channelChanges.lastVideoPublishedAt = video.publishedAt;
            }

            const channelVideoIds = ensureMap(channelIdVideoIds, video.channelId, []);
            channelVideoIds.push(video.id);
          });

          return this.main.db.getChatIdChannelIdByChannelIds(channelIds).then((chatIdChannelIdList) => {
            const channelIdChats = new Map();
            chatIdChannelIdList.forEach((chatIdChannelId) => {
              const chats = ensureMap(channelIdChats, chatIdChannelId.channelId, []);
              if (!chatIdChannelId.chat.channelId || !chatIdChannelId.chat.isMuted) {
                chats.push({chatId: chatIdChannelId.chat.id, createdAt: chatIdChannelId.createdAt});
              }
              if (chatIdChannelId.chat.channelId) {
                chats.push({chatId: chatIdChannelId.chat.channelId, createdAt: chatIdChannelId.createdAt});
              }
            });

            const chatIdVideoIdChanges = [];
            for (const [channelId, chats] of channelIdChats.entries()) {
              const videoIds = channelIdVideoIds.get(channelId);
              if (videoIds) {
                videoIds.forEach((videoId) => {
                  const video = videoIdVideo.get(videoId);
                  chats.forEach(({chatId, createdAt}) => {
                    if (video.publishedAt.getTime() > createdAt.getTime()) {
                      chatIdVideoIdChanges.push({chatId, videoId});
                    }
                  });
                });
              }
            }

            const channelsChanges = Object.values(channelIdsChanges);

            return this.main.db.putVideos(channelsChanges, videos, chatIdVideoIdChanges).then(() => {
              videos.forEach((video) => {
                this.log.write(`[insert] ${video.channelId} ${video.id}`);
              });

              if (videos.length) {
                this.main.sender.checkThrottled();
              }

              return {
                channelsChangesCount: channelsChanges.length,
                videosCount: videos.length,
                chatIdVideoIdChangesCount: chatIdVideoIdChanges.length,
              };
            });
          });
        });
      }
    }));
  }

  clean() {
    return this.oneLimit(() => {
      return Promise.all([
        this.main.db.cleanChats().then((chatsCount) => {
          return this.main.db.cleanChannels().then((channelsCount) => {
            return [chatsCount, channelsCount];
          });
        }),
        this.main.db.cleanVideos()
      ]).then(([[removedChats, removedChannels], removedVideos]) => {
        return {removedChats, removedChannels, removedVideos};
      });
    });
  }
}

export default Checker;