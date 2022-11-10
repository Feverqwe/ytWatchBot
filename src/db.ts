import ErrorWithCode from "./tools/errorWithCode";
import arrayByPart from "./tools/arrayByPart";
import serviceId from "./tools/serviceId";
import arrayDifference from "./tools/arrayDifference";
import Sequelize, {Op, Transaction} from "sequelize";
import Main from "./main";
import {ServiceChannel, ServiceInterface} from "./checker";
import assertType from "./tools/assertType";
import {Feed} from "./ytPubSub";

const debug = require('debug')('app:db');
const ISOLATION_LEVELS = Transaction.ISOLATION_LEVELS;

export interface NewChat {
  id: string;
  channelId?: string|null;
  isHidePreview?: boolean;
  isMuted?: boolean;
  sendTimeoutExpiresAt?: Date;
  parentChatId?: string|null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class ChatModel extends Sequelize.Model {
  declare id: string;
  declare channelId: string|null;
  declare isHidePreview: boolean;
  declare isMuted: boolean;
  declare sendTimeoutExpiresAt: Date;
  declare parentChatId: string|null;

  declare createdAt: Date;
  declare updatedAt: Date;
}
export interface ChatModelWithOptionalChannel extends ChatModel {
  channel: ChatModel|null,
}

export class ChannelModel extends Sequelize.Model {
  declare id: string;
  declare service: string;
  declare title: string;
  declare url: string;
  declare hasChanges: boolean;
  declare lastVideoPublishedAt: Date | null;
  declare lastSyncAt: Date;
  declare lastFullSyncAt: Date;
  declare syncTimeoutExpiresAt: Date;
  declare subscriptionExpiresAt: Date;
  declare subscriptionTimeoutExpiresAt: Date;

  declare createdAt: Date;
  declare updatedAt: Date;
}
export interface NewChannel {
  id: string;
  service: string;
  title: string;
  url: string;
  hasChanges?: boolean;
  lastVideoPublishedAt?: Date;
  lastSyncAt?: Date;
  lastFullSyncAt?: Date;
  syncTimeoutExpiresAt?: Date;
  subscriptionExpiresAt?: Date;
  subscriptionTimeoutExpiresAt?: Date;
}

export class YtPubSubModel extends Sequelize.Model {
  declare videoId: string;
  declare channelId: string | null;
  declare publishedAt: Date | null;
  declare lastSyncAt: Date;

  declare createdAt: Date;
}

export class ChatIdChannelIdModel extends Sequelize.Model {
  declare chatId: string;
  declare channelId: string;
  declare createdAt: Date;
}
export interface NewChatIdChannelIdModel {
  chatId: string;
  channelId: string;
}

export class VideoModel extends Sequelize.Model {
  declare id: string;
  declare url: string;
  declare title: string;
  declare previews: string[];
  declare duration: string|null;
  declare channelId: string;
  declare publishedAt: Date;
  declare telegramPreviewFileId: string|null;
  declare mergedId: string | null;
  declare mergedChannelId: string | null;
  declare createdAt: Date;
}
export interface VideoModelWithChannel extends VideoModel {
  channel: ChannelModel,
}
export interface NewVideo {
  id: string;
  url: string;
  title: string;
  previews: string[];
  duration?: string|null;
  channelId: string;
  publishedAt: Date;
  telegramPreviewFileId?: string|null;
  mergedId?: string | null;
  mergedChannelId?: string | null;
}

export class ChatIdVideoIdModel extends Sequelize.Model {
  declare id: number;
  declare chatId: string;
  declare videoId: string;
  declare createdAt: Date;
}
export interface NewChatIdVideoId {
  chatId: string;
  videoId: string;
}

export class VideoIdModel extends Sequelize.Model {
  declare id: string;
  declare channelId: string;
  declare createdAt: Date;
}

class Db {
  private sequelize: Sequelize.Sequelize;
  constructor(private main: Main) {
    this.sequelize = new Sequelize.Sequelize(main.config.db.database, main.config.db.user, main.config.db.password, {
      host: main.config.db.host,
      port: main.config.db.port,
      dialect: 'mariadb',
      omitNull: true,
      logging: false,
      /*dialectOptions: {
        charset: 'utf8mb4',
        collate: 'utf8mb4_general_ci'
      },*/
      define: {
        charset: 'utf8mb4',
      },
      pool: {
        max: 30,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    });

    ChatModel.init({
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: true},
      isHidePreview: {type: Sequelize.BOOLEAN, defaultValue: false},
      isMuted: {type: Sequelize.BOOLEAN, defaultValue: false},
      sendTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      parentChatId: {type: Sequelize.STRING(191), allowNull: true},
    }, {
      sequelize: this.sequelize,
      modelName: 'chat',
      tableName: 'chats',
      timestamps: true,
      indexes: [{
        name: 'channelId_UNIQUE',
        unique: true,
        fields: ['channelId']
      },{
        name: 'sendTimeoutExpiresAt_idx',
        fields: ['sendTimeoutExpiresAt']
      }]
    });
    ChatModel.belongsTo(ChatModel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'SET NULL', as: 'channel'});
    ChatModel.belongsTo(ChatModel, {foreignKey: 'parentChatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE', as: 'parentChat'});

    ChannelModel.init({
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      service: {type: Sequelize.STRING(191), allowNull: false},
      title: {type: Sequelize.TEXT, allowNull: true},
      url: {type: Sequelize.TEXT, allowNull: false},
      hasChanges: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      lastVideoPublishedAt: {type: Sequelize.DATE, allowNull: true, defaultValue: null},
      lastSyncAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      lastFullSyncAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      syncTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      subscriptionExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      subscriptionTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
    }, {
      sequelize: this.sequelize,
      modelName: 'channel',
      tableName: 'channels',
      timestamps: true,
      indexes: [{
        name: 'hasChanges_idx',
        fields: ['hasChanges']
      }, {
        name: 'lastVideoPublishedAt_idx',
        fields: ['lastVideoPublishedAt']
      }, {
        name: 'lastSyncAt_idx',
        fields: ['lastSyncAt']
      }, {
        name: 'syncTimeoutExpiresAt_idx',
        fields: ['syncTimeoutExpiresAt']
      }, {
        name: 'subscriptionExpiresAt_subscriptionTimeoutExpiresAt_idx',
        fields: ['subscriptionExpiresAt', 'subscriptionTimeoutExpiresAt']
      }]
    });

    YtPubSubModel.init({
      videoId: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: true, defaultValue: null},
      publishedAt: {type: Sequelize.DATE, allowNull: true, defaultValue: null},
      lastPushAt: {type: Sequelize.DATE, allowNull: false},
    }, {
      sequelize: this.sequelize,
      modelName: 'ytPubSub',
      timestamps: true,
      updatedAt: false,
      indexes: [{
        name: 'lastPushAt_idx',
        fields: ['lastPushAt']
      }]
    });

    ChatIdChannelIdModel.init( {
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
    }, {
      sequelize: this.sequelize,
      modelName: 'chatIdChannelId',
      tableName: 'chatIdChannelId',
      timestamps: true,
      updatedAt: false,
      indexes: [{
        name: 'chatId_channelId_UNIQUE',
        unique: true,
        fields: ['chatId', 'channelId']
      }, {
        name: 'chatId_idx',
        fields: ['chatId']
      }, {
        name: 'channelId_idx',
        fields: ['channelId']
      }, {
        name: 'createdAt_idx',
        fields: ['createdAt']
      }]
    });
    ChatIdChannelIdModel.belongsTo(ChatModel, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdChannelIdModel.belongsTo(ChannelModel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    VideoModel.init({
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      url: {type: Sequelize.STRING(191), allowNull: false},
      title: {type: Sequelize.STRING(191), allowNull: false},
      previews: {type: Sequelize.JSON, allowNull: false},
      duration: {type: Sequelize.STRING(191), allowNull: true},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      publishedAt: {type: Sequelize.DATE, allowNull: false},
      telegramPreviewFileId: {type: Sequelize.TEXT, allowNull: true},
      mergedId: {type: Sequelize.STRING(191), allowNull: true},
      mergedChannelId: {type: Sequelize.STRING(191), allowNull: true},
    }, {
      sequelize: this.sequelize,
      modelName: 'video',
      tableName: 'videos',
      timestamps: true,
      updatedAt: false,
      indexes: [{
        name: 'publishedAt_idx',
        fields: ['publishedAt']
      }]
    });
    VideoModel.belongsTo(ChannelModel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    VideoIdModel.init({
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
    }, {
      sequelize: this.sequelize,
      modelName: 'videoIds',
      tableName: 'videoIds',
      timestamps: true,
      updatedAt: false,
    })
    VideoIdModel.belongsTo(ChannelModel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    ChatIdVideoIdModel.init({
      id: {type: Sequelize.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true},
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      videoId: {type: Sequelize.STRING(191), allowNull: false},
    }, {
      sequelize: this.sequelize,
      modelName: 'chatIdVideoId',
      tableName: 'chatIdVideoId',
      timestamps: true,
      updatedAt: false,
      indexes: [{
        name: 'chatId_videoId_UNIQUE',
        unique: true,
        fields: ['chatId', 'videoId']
      },{
        name: 'chatId_idx',
        fields: ['chatId']
      }]
    });
    ChatIdVideoIdModel.belongsTo(ChatModel, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdVideoIdModel.belongsTo(VideoModel, {foreignKey: 'videoId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
  }

  init() {
    return this.sequelize.authenticate().then(() => {
      return this.sequelize.sync();
    }).then(() => {
      return this.removeChannelByIds(this.main.config.channelBlackList);
    });
  }

  ensureChat(id: string) {
    return ChatModel.findOrCreate({
      where: {id},
      include: [
        {model: ChatModel, as: 'channel'}
      ]
    }).then(([model, isCreated]) => {
      assertType<ChatModelWithOptionalChannel>(model);
      return model;
    });
  }

  createChatChannel(chatId: string, channelId: string) {
    return this.sequelize.transaction({
      isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
    }, async (transaction) => {
      await ChatModel.create({
        id: channelId,
        parentChatId: chatId,
      }, {
        transaction
      });
      await ChatModel.upsert({
        id: chatId,
        channelId: channelId
      }, {
        transaction
      })
    });
  }

  changeChatId(id: string, newId: string) {
    return ChatModel.update({id: newId}, {
      where: {id}
    });
  }

  getChatIds(offset: number, limit: number) {
    return ChatModel.findAll({
      offset,
      limit,
      attributes: ['id']
    }).then((chats: Pick<ChatModel, 'id'>[]) => {
      return chats.map(chat => chat.id);
    });
  }

  getChatById(id: string) {
    return ChatModel.findByPk(id).then((chat) => {
      if (!chat) {
        throw new ErrorWithCode('Chat is not found', 'CHAT_IS_NOT_FOUND');
      }
      return chat;
    });
  }

  getChatsByIds(ids: string[]) {
    return ChatModel.findAll({
      where: {id: ids},
    });
  }

  setChatSendTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + this.main.config.chatSendTimeoutAfterErrorMinutes * 60);
    return ChatModel.update({sendTimeoutExpiresAt: date}, {
      where: {id: ids}
    });
  }

  deleteChatById(id: string) {
    return ChatModel.destroy({
      where: {id}
    });
  }

  deleteChatsByIds(ids: string[]) {
    return ChatModel.destroy({
      where: {id: ids}
    });
  }

  cleanChats() {
    return ChatModel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT chatId FROM chatIdChannelId)`)},
        parentChatId: null
      }
    });
  }

  async ensureChannel(service: ServiceInterface, rawChannel: ServiceChannel) {
    const id = serviceId.wrap(service, rawChannel.id);

    if (this.main.config.channelBlackList.includes(id)) {
      throw new ErrorWithCode('Channel in black list', 'CHANNEL_IN_BLACK_LIST');
    }

    return ChannelModel.findOrCreate({
      where: {id},
      defaults: Object.assign({}, rawChannel, {id, service: service.id}) as any,
    }).then(([channel, isCreated]) => {
      return channel;
    });
  }

  getChatIdChannelIdChatIdCount() {
    return this.sequelize.query<{chatCount: number}>(`
      SELECT COUNT(DISTINCT(chatId)) as chatCount FROM chatIdChannelId
    `, {type: Sequelize.QueryTypes.SELECT}).then((results) => {
      const result = results[0];
      if (!result) {
        return 0;
      }
      return result.chatCount;
    });
  }

  getChatIdChannelIdChannelIdCount() {
    return this.sequelize.query<{channelCount: number}>(`
      SELECT COUNT(DISTINCT(channelId)) as channelCount FROM chatIdChannelId
    `, {type: Sequelize.QueryTypes.SELECT}).then((results) => {
      const result = results[0];
      if (!result) {
        return 0;
      }
      return result.channelCount;
    });
  }

  getChatIdChannelIdTop10ByServiceId(serviceId: string) {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    return this.sequelize.query<{
      channelId: string, service: string, chatCount: number, title: string
    }>(`
      SELECT channelId, COUNT(chatId) as chatCount, channels.service as service, channels.title as title FROM chatIdChannelId
      INNER JOIN channels ON channelId = channels.id
      WHERE channels.service = "${serviceId}" AND channels.lastVideoPublishedAt > "${dateToSql(monthAgo)}"
      GROUP BY channelId ORDER BY COUNT(chatId) DESC LIMIT 10
    `, {type: Sequelize.QueryTypes.SELECT});
  }

  getChannelsByChatId(chatId: string) {
    return ChatIdChannelIdModel.findAll({
      include: [
        {model: ChannelModel, required: true}
      ],
      where: {chatId},
      attributes: [],
      order: ['createdAt'],
    }).then((chatIdChannelIdList: {}[]) => {
      assertType<{channel: ChannelModel}[]>(chatIdChannelIdList);
      return chatIdChannelIdList.map(chatIdChannelId => chatIdChannelId.channel);
    });
  }

  getChannelsByIds(ids: string[]) {
    return ChannelModel.findAll({
      where: {id: ids}
    });
  }

  getChannelById(id: string) {
    return ChannelModel.findByPk(id).then((channel) => {
      if (!channel) {
        throw new ErrorWithCode('Channel is not found', 'CHANNEL_IS_NOT_FOUND');
      }
      return channel;
    });
  }

  getChannelCountByChatId(chatId: string) {
    return ChatIdChannelIdModel.count({
      where: {chatId}
    });
  }

  putChatIdChannelId(chatId: string, channelId: string) {
    return ChatIdChannelIdModel.upsert({chatId, channelId}).then(([model, isCreated]) => {
      return isCreated as boolean; // cause mariadb
    });
  }

  deleteChatIdChannelId(chatId: string, channelId: string) {
    return ChatIdChannelIdModel.destroy({
      where: {chatId, channelId}
    });
  }

  getChannelIdsWithExpiresSubscription(limit = 50) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + this.main.config.updateChannelPubSubSubscribeIfExpiresLessThenMinutes * 60);
    return ChannelModel.findAll({
      where: {
        subscriptionExpiresAt: {[Op.lt]: date},
        subscriptionTimeoutExpiresAt: {[Op.lt]: new Date()}
      },
      limit: limit,
      attributes: ['id']
    }).then((results: Pick<ChannelModel, 'id'>[]) => {
      return results.map(item => item.id);
    });
  }

  getChannelsForSync(limit: number) {
    const date = new Date();
    date.setHours(date.getHours() - this.main.config.checkChannelIfLastSyncLessThenHours);
    return ChannelModel.findAll({
      where: {
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
        [Op.or]: [
          {hasChanges: true},
          {lastSyncAt: {[Op.lt]: date}}
        ],
      },
      order: Sequelize.literal(`lastVideoPublishedAt IS NULL, lastSyncAt`),
      limit: limit,
    });
  }

  getChannelIdsByServiceId(service: string, offset: number, limit: number) {
    return ChannelModel.findAll({
      where: {service},
      attributes: ['id'],
      offset, limit,
    }).then((channels: Pick<ChannelModel, 'id'>[]) => {
      return channels.map(channel => channel.id);
    });
  }

  setChannelsSyncTimeoutExpiresAtAndUncheckChanges(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + this.main.config.channelSyncTimeoutMinutes * 60);
    return ChannelModel.update({
      syncTimeoutExpiresAt: date,
      hasChanges: false
    }, {
      where: {id: ids}
    });
  }

  setChannelsSubscriptionExpiresAt(ids: string[], expiresAt: Date) {
    return ChannelModel.update({subscriptionExpiresAt: expiresAt}, {
      where: {id: ids}
    });
  }

  setChannelsSubscriptionTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + this.main.config.channelPubSubSubscribeTimeoutMinutes * 60);
    return ChannelModel.update({subscriptionTimeoutExpiresAt: date}, {
      where: {id: ids}
    });
  }

  async removeChannelByIds(ids: string[]) {
    if (!ids.length) return;
    return ChannelModel.destroy({where: {id: ids}});
  }

  cleanChannels() {
    return ChannelModel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT channelId FROM chatIdChannelId)`)}
      }
    });
  }

  putYtPubSub(feeds: Feed[], channelsChanges: NewChannel[], channelIds: string[]) {
    return this.sequelize.transaction({
      isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
    }, async (transaction) => {
      await Promise.all([
        /*bulk(feeds, (feeds) => {
          return YtPubSubModel.bulkCreate(feeds, {
            updateOnDuplicate: ['channelId', 'publishedAt', 'lastPushAt'],
            transaction
          });
        }),*/
        bulk(channelsChanges, (channelsChanges) => {
          return ChannelModel.bulkCreate(channelsChanges as any, {
            updateOnDuplicate: ['lastVideoPublishedAt'],
            transaction,
          });
        }),
        ChannelModel.update({
          hasChanges: true
        }, {
          transaction,
          where: {id: channelIds}
        })
      ]);
    });
  }

  getExistsYtPubSubVideoIds(ids: string[]) {
    return YtPubSubModel.findAll({
      where: {videoId: ids},
      attributes: ['videoId']
    }).then((items: Pick<YtPubSubModel, 'videoId'>[]) => {
      return items.map(item => item.videoId);
    });
  }

  cleanYtPubSub() {
    const date = new Date();
    date.setDate(date.getDate() - this.main.config.cleanPubSubFeedIfPushOlderThanDays);
    return YtPubSubModel.destroy({
      where: {
        lastPushAt: {[Op.lt]: date}
      }
    });
  }

  getExistsVideoIds(ids: string[]) {
    return VideoIdModel.findAll({
      where: {id: ids},
      attributes: ['id']
    }).then((videos: Pick<VideoIdModel, 'id'>[]) => {
      return videos.map(video => video.id);
    });
  }

  status = -1;
  syncVideoIds = async () => {
    if (this.status !== -1) return this.status;
    let limit = 50000;
    let offset = 0;
    while (true) {
      this.status = offset;
      const videos = await VideoModel.findAll({
        attributes: ['id', 'channelId', 'createdAt'],
        offset,
        limit,
      }).then((items) => {
        return items.map(({id, channelId, createdAt}) => {
          return ({id, channelId, createdAt});
        });
      });
      offset += limit;
      if (!videos.length) break;
      await VideoIdModel.bulkCreate(videos, {
        ignoreDuplicates: true,
      });
    }
  }

  getNoExistsVideoIds(ids: string[]) {
    return this.getExistsVideoIds(ids).then((results) => {
      return arrayDifference(ids, results);
    });
  }

  getChatIdChannelIdByChannelIds(channelIds: string[]) {
    return ChatIdChannelIdModel.findAll({
      where: {channelId: channelIds},
      include: [{
        model: ChatModel,
        attributes: ['id', 'channelId', 'isMuted'],
        required: true
      }]
    }).then((results) => {
      assertType<(ChatIdChannelIdModel & {chat: Pick<ChatModel, 'id' | 'channelId' | 'isMuted'>})[]>(results);
      return results;
    });
  }

  cleanVideos() {
    const date = new Date();
    date.setDate(date.getDate() - this.main.config.cleanVideosIfPublishedOlderThanDays);
    return VideoModel.destroy({
      where: {
        publishedAt: {[Op.lt]: date}
      }
    });
  }

  putVideos(channelsChanges: NewChannel[], videos: NewVideo[], chatIdVideoIdChanges: NewChatIdVideoId[]) {
    let retry = 3;

    const doTry = (): Promise<void> => {
      return this.sequelize.transaction({
        isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
      }, async (transaction) => {
        await Promise.all([
          bulk(channelsChanges, (channelsChanges) => {
            return ChannelModel.bulkCreate(channelsChanges as any, {
              updateOnDuplicate: ['lastSyncAt', 'lastFullSyncAt', 'lastVideoPublishedAt', 'title'],
              transaction
            });
          }),
          bulk(videos, (videos) => {
            return VideoModel.bulkCreate(videos as any, {
              transaction
            });
          }),
          bulk(videos, (videos) => {
            const videoIds = videos.map(video => ({
              id: video.id,
              channelId: video.channelId,
            }));
            return VideoIdModel.bulkCreate(videoIds, {
              transaction
            });
          }),
        ]);

        await bulk(chatIdVideoIdChanges, (chatIdVideoIdChanges) => {
          return ChatIdVideoIdModel.bulkCreate(chatIdVideoIdChanges as any, {
            transaction
          });
        });
      }).catch((err) => {
        if (/Deadlock found when trying to get lock/.test(err.message) && --retry > 0) {
          return new Promise(r => setTimeout(r, 250)).then(() => doTry());
        }
        throw err;
      });
    };

    return doTry();
  }

  getDistinctChatIdVideoIdChatIds() {
    return this.sequelize.query<{chatId: string}>(`
      SELECT DISTINCT chatId FROM chatIdVideoId
      INNER JOIN chats ON chatIdVideoId.chatId = chats.id
      WHERE chats.sendTimeoutExpiresAt < "${dateToSql(new Date())}"
    `,  { type: Sequelize.QueryTypes.SELECT}).then((results) => {
      return results.map(result => result.chatId);
    });
  }

  getVideoIdsByChatId(chatId: string, limit = 10) {
    return ChatIdVideoIdModel.findAll({
      where: {chatId},
      include: [{
        model: VideoModel,
        attributes: ['publishedAt'],
        required: true,
      }],
      order: [Sequelize.literal('video.publishedAt')],
      attributes: ['videoId'],
      limit: limit,
    }).then((results: Pick<ChatIdVideoIdModel, 'videoId'>[]) => {
      assertType<(Pick<ChatIdVideoIdModel, 'videoId'> & {video: Pick<VideoModel, 'publishedAt'>})[]>(results);
      return results.map(chatIdVideoId => chatIdVideoId.videoId);
    });
  }

  getVideoWithChannelById(id: string) {
    return VideoModel.findOne({
      where: {id},
      include: [
        {model: ChannelModel, required: true}
      ]
    }).then((video) => {
      if (!video) {
        throw new ErrorWithCode('Video is not found', 'VIDEO_IS_NOT_FOUND');
      }
      assertType<VideoModelWithChannel>(video);
      return video;
    });
  }

  deleteChatIdVideoId(chatId: string, videoId: string) {
    return ChatIdVideoIdModel.destroy({
      where: {chatId, videoId}
    });
  }
}

function bulk<T, F>(results: T[], callback: (results: T[]) => F):Promise<F[]> {
  const resultsParts = arrayByPart(results, 100);
  return Promise.all(resultsParts.map(results => callback(results)));
}

function dateToSql(date: Date) {
  const [YYYY, MM, DD, HH, mm, ss] = [
    date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()
  ].map(v => ((v < 10) ? '0' : '') + v);
  return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;
}

export default Db;