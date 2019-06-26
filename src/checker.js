import arrayDifferent from "./tools/arrayDifferent";
import LogFile from "./logFile";
import arrayByPart from "./tools/arrayByPart";
import parallel from "./tools/parallel";

const debug = require('debug')('app:Checker');
const promiseLimit = require('promise-limit');

const oneLimit = promiseLimit(1);

class Checker {
  constructor(/**Main*/main) {
    this.main = main;
    this.log = new LogFile('checker');
  }

  init() {
    this.startUpdateInterval();
    this.startCleanInterval();
  }

  updateIntervalId = null;
  startUpdateInterval() {
    clearInterval(this.updateIntervalId);
    this.updateIntervalId = setInterval(() => {
      this.check();
    }, 5 * 60 * 1000);
  }

  cleanIntervalId = null;
  startCleanInterval() {
    clearInterval(this.cleanIntervalId);
    this.cleanIntervalId = setInterval(() => {
      this.clean();
    }, 60 * 60 * 1000);
  }

  check() {
    return oneLimit(() => {
      return this.main.db.getChannelsForSync().then((channels) => {
        return parallel(1, arrayByPart(channels, 50), (channels) => {
          const channelIdChannel = new Map();
          const channelIds = [];
          const rawChannels = [];
          channels.forEach(channel => {
            channelIds.push(channel.id);
            channelIdChannel.set(channel.id, channel);

            let publishedAfter = channel.lastSyncAt;


            const defaultDate = new Date();
            defaultDate.setDate(defaultDate.getDate() - 7);

            if (publishedAfter && new Date(publishedAfter).getTime() < defaultDate.getTime()) {
              publishedAfter = null;
            }
            if (publishedAfter === null) {
              publishedAfter = defaultDate;
            }

            rawChannels.push({
              id: channel.rawId,
              publishedAfter: publishedAfter
            });
          });

          const syncAt = new Date();
          return this.main.db.setChannelsSyncTimeoutExpiresAtAndUncheckChanges(channelIds, 5).then(() => {
            return this.main.youtube.getVideos(rawChannels);
          }).then(({videos: rawVideos, skippedChannelIds: skippedRawChannelIds}) => {
            const videoIdVideo = new Map();
            const videoIds = [];
            rawVideos.forEach((video) => {
              video.id = this.main.db.model.Channel.buildId('youtube', video.id);
              video.channelId = this.main.db.model.Channel.buildId('youtube', video.channelId);

              if (!channelIdChannel.has(video.channelId)) {
                debug('Video %s skip, cause: Channel %s is not exists', video.id, video.channelId);
                return;
              }

              videoIdVideo.set(video.id, video);
              videoIds.push(video.id);
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
                channelIds: checkedChannelIds
              }
            });
          }).then(({videos, channelIds}) => {
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
              if (channel.title !== video.channelTitle) {
                channelIdsChanges[channel.id].title = video.channelTitle;
              }

              let channelVideoIds = channelIdVideoIds.get(video.channelId);
              if (!channelVideoIds) {
                channelIdVideoIds.set(video.channelId, channelVideoIds = []);
              }
              channelVideoIds.push(video.id);
            });

            return this.main.db.getChatIdChannelIdByChannelIds(channelIds).then((chatIdChannelIdList) => {
              const channelIdChatIds = new Map();
              chatIdChannelIdList.forEach((chatIdChannelId) => {
                let chatIds = channelIdChatIds.get(chatIdChannelId.channelId);
                if (!chatIds) {
                  channelIdChatIds.set(chatIdChannelId.channelId, chatIds = []);
                }
                if (!chatIdChannelId.chat.isMuted) {
                  chatIds.push(chatIdChannelId.chat.id);
                }
                if (chatIdChannelId.chat.channelId) {
                  chatIds.push(chatIdChannelId.chat.channelId);
                }
              });

              const chatIdVideoIdChanges = [];
              for (const [channelId, chatIds] of channelIdChatIds.entries()) {
                const videoIds = channelIdVideoIds.get(channelId);
                if (videoIds) {
                  videoIds.forEach((videoId) => {
                    chatIds.forEach((chatId) => {
                      chatIdVideoIdChanges.push({chatId, videoId});
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
        });
      });
    });
  }

  clean() {
    return oneLimit(() => {
      return Promise.all([
        this.main.db.cleanChannels(),
        this.main.db.cleanVideos()
      ]).then(([removedChannels, removedVideos]) => {
        return {removedChannels, removedVideos};
      });
    });
  }
}

export default Checker;