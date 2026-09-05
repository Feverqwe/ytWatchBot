import ErrorWithCode from '../shared/tools/errorWithCode';
import arrayByPart from '../shared/tools/arrayByPart';
import serviceId from '../tools/serviceId';
import arrayDifference from '../shared/tools/arrayDifference';
import Sequelize, {Op, Transaction} from 'sequelize';
import type Main from '../main';
import type {ServiceChannel, ServiceInterface} from '../checker';
import {Feed} from '../ytPubSub';
import {appConfig} from '../appConfig';
import {getDebug} from '../shared/tools/getDebug';
import isDatabaseDeadlock from '../shared/tools/isDatabaseDeadlock';
import createMigrator from '../shared/migrator';
import {
  ChannelModel,
  ChatIdChannelIdModel,
  ChatIdVideoIdModel,
  ChatModel,
  VideoModel,
  YtPubSubModel,
  initModels,
} from './models';
import type {NewChannel, NewChatIdVideoId, NewVideo} from './models';

const debug = getDebug('app:db');
const ISOLATION_LEVELS = Transaction.ISOLATION_LEVELS;

class Db {
  private sequelize: Sequelize.Sequelize;
  constructor(private main: Main) {
    this.sequelize = new Sequelize.Sequelize(
      appConfig.db.database,
      appConfig.db.user,
      appConfig.db.password,
      {
        host: appConfig.db.host,
        port: appConfig.db.port,
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
          idle: 10000,
        },
      },
    );

    initModels(this.sequelize);
  }

  async init() {
    await this.sequelize.authenticate();
    await createMigrator(this.sequelize).up();
    await this.removeChannelByIds(appConfig.channelBlackList);
  }

  async close() {
    await this.sequelize.close();
  }

  async ensureChat(id: string) {
    const [model, isCreated] = await ChatModel.findOrCreate({
      where: {id},
      include: [{model: ChatModel, as: 'channel'}],
    });
    const {channel} = model;
    if (channel === undefined) {
      throw new Error('Chat channel association was not loaded');
    }
    return Object.assign(model, {channel});
  }

  createChatChannel(chatId: string, channelId: string) {
    return this.sequelize.transaction(
      {
        isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
      },
      async (transaction) => {
        await ChatModel.create(
          {
            id: channelId,
            parentChatId: chatId,
          },
          {
            transaction,
          },
        );
        await ChatModel.upsert(
          {
            id: chatId,
            channelId: channelId,
          },
          {
            transaction,
          },
        );
      },
    );
  }

  changeChatId(id: string, newId: string) {
    return ChatModel.update(
      {id: newId},
      {
        where: {id},
      },
    );
  }

  async getChatIds(offset: number, limit: number) {
    const chats: Pick<ChatModel, 'id'>[] = await ChatModel.findAll({
      offset,
      limit,
      attributes: ['id'],
    });
    return chats.map((chat) => chat.id);
  }

  async getChatById(id: string) {
    const chat = await ChatModel.findByPk(id);
    if (!chat) {
      throw new ErrorWithCode('Chat is not found', 'CHAT_IS_NOT_FOUND');
    }
    return chat;
  }

  getChatsByIds(ids: string[]) {
    return ChatModel.findAll({
      where: {id: ids},
    });
  }

  setChatSendTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + appConfig.chatSendTimeoutAfterErrorMinutes * 60);
    return ChatModel.update(
      {sendTimeoutExpiresAt: date},
      {
        where: {id: ids},
      },
    );
  }

  deleteChatById(id: string) {
    return ChatModel.destroy({
      where: {id},
    });
  }

  deleteChatsByIds(ids: string[]) {
    return ChatModel.destroy({
      where: {id: ids},
    });
  }

  cleanChats() {
    return ChatModel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT chatId FROM chatIdChannelId)`)},
        parentChatId: null,
      },
    });
  }

  async ensureChannel(service: ServiceInterface, rawChannel: ServiceChannel) {
    const id = serviceId.wrap(service, rawChannel.id);

    if (appConfig.channelBlackList.includes(id)) {
      throw new ErrorWithCode('Channel in black list', 'CHANNEL_IN_BLACK_LIST');
    }

    const [channel, isCreated] = await ChannelModel.findOrCreate({
      where: {id},
      defaults: Object.assign({}, rawChannel, {id, service: service.id}),
    });
    return channel;
  }

  async getChatIdChannelIdChatIdCount() {
    const count = await ChatIdChannelIdModel.count({
      col: 'chatId',
      distinct: true,
    });
    return count;
  }

  async getChatIdChannelIdChannelIdCount() {
    const count = await ChatIdChannelIdModel.count({
      col: 'channelId',
      distinct: true,
    });
    return count;
  }

  async getChatIdChannelIdTop10ByServiceId(serviceId: string) {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const results = await ChatIdChannelIdModel.findAll({
      include: [
        {
          model: ChannelModel,
          required: true,
          attributes: ['title', 'service'],
          where: [
            {
              service: serviceId,
              lastVideoPublishedAt: {[Op.gt]: monthAgo},
            },
          ],
        },
      ],
      attributes: ['channelId', [Sequelize.fn('COUNT', Sequelize.col('chatId')), 'chatCount']],
      group: 'channelId',
      order: [['chatCount', 'DESC']],
      limit: 10,
    });

    return results.map(({channel, channelId, chatCount}) => {
      if (!channel || chatCount === undefined) {
        throw new Error('Top channel query did not return all selected fields');
      }
      return {channelId, chatCount, title: channel.title, service: channel.service};
    });
  }

  async getChannelsByChatId(chatId: string) {
    const chatIdChannelIdList = await ChatIdChannelIdModel.findAll({
      include: [{model: ChannelModel, required: true}],
      where: {chatId},
      attributes: [],
      order: ['createdAt'],
    });
    return chatIdChannelIdList.map((chatIdChannelId) => {
      const {channel} = chatIdChannelId;
      if (!channel) {
        throw new Error('Channel association was not loaded');
      }
      return channel;
    });
  }

  getChannelsByIds(ids: string[]) {
    return ChannelModel.findAll({
      where: {id: ids},
    });
  }

  async getChannelById(id: string) {
    const channel = await ChannelModel.findByPk(id);
    if (!channel) {
      throw new ErrorWithCode('Channel is not found', 'CHANNEL_IS_NOT_FOUND');
    }
    return channel;
  }

  getChannelCountByChatId(chatId: string) {
    return ChatIdChannelIdModel.count({
      where: {chatId},
    });
  }

  async putChatIdChannelId(chatId: string, channelId: string) {
    const [model, isCreated] = await ChatIdChannelIdModel.upsert({chatId, channelId});
    return Boolean(isCreated);
  }

  deleteChatIdChannelId(chatId: string, channelId: string) {
    return ChatIdChannelIdModel.destroy({
      where: {chatId, channelId},
    });
  }

  async getChannelIdsWithExpiresSubscription(limit = 50) {
    const date = new Date();
    date.setSeconds(
      date.getSeconds() + appConfig.updateChannelPubSubSubscribeIfExpiresLessThenMinutes * 60,
    );
    const results: Pick<ChannelModel, 'id'>[] = await ChannelModel.findAll({
      where: {
        subscriptionExpiresAt: {[Op.lt]: date},
        subscriptionTimeoutExpiresAt: {[Op.lt]: new Date()},
      },
      limit: limit,
      attributes: ['id'],
    });
    return results.map((item) => item.id);
  }

  getChannelsForSync(limit: number) {
    const date = new Date();
    date.setHours(date.getHours() - appConfig.checkChannelIfLastSyncLessThenHours);
    return ChannelModel.findAll({
      where: {
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
        [Op.or]: [{hasChanges: true}, {lastSyncAt: {[Op.lt]: date}}],
      },
      order: Sequelize.literal(`lastVideoPublishedAt IS NULL, lastSyncAt`),
      limit: limit,
    });
  }

  async getChannelIdsByServiceId(service: string, offset: number, limit: number) {
    const channels: Pick<ChannelModel, 'id'>[] = await ChannelModel.findAll({
      where: {service},
      attributes: ['id'],
      offset,
      limit,
    });
    return channels.map((channel) => channel.id);
  }

  setChannelsSyncTimeoutExpiresAtAndUncheckChanges(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + appConfig.channelSyncTimeoutMinutes * 60);
    return ChannelModel.update(
      {
        syncTimeoutExpiresAt: date,
        hasChanges: false,
      },
      {
        where: {id: ids},
      },
    );
  }

  setChannelsSubscriptionExpiresAt(ids: string[], expiresAt: Date) {
    return ChannelModel.update(
      {subscriptionExpiresAt: expiresAt},
      {
        where: {id: ids},
      },
    );
  }

  setChannelsSubscriptionTimeoutExpiresAt(ids: string[]) {
    const date = new Date();
    date.setSeconds(date.getSeconds() + appConfig.channelPubSubSubscribeTimeoutMinutes * 60);
    return ChannelModel.update(
      {subscriptionTimeoutExpiresAt: date},
      {
        where: {id: ids},
      },
    );
  }

  async removeChannelByIds(ids: string[]) {
    if (!ids.length) return;
    return ChannelModel.destroy({where: {id: ids}});
  }

  cleanChannels() {
    return ChannelModel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT channelId FROM chatIdChannelId)`)},
      },
    });
  }

  putYtPubSub(feeds: Feed[], channelsChanges: NewChannel[], channelIds: string[]) {
    return this.sequelize.transaction(
      {
        isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
      },
      async (transaction) => {
        await Promise.all([
          /*bulk(feeds, (feeds) => {
          return YtPubSubModel.bulkCreate(feeds, {
            updateOnDuplicate: ['channelId', 'publishedAt', 'lastPushAt'],
            transaction
          });
        }),*/
          bulk(channelsChanges, (channelsChanges) => {
            return ChannelModel.bulkCreate(channelsChanges, {
              updateOnDuplicate: ['lastVideoPublishedAt'],
              transaction,
            });
          }),
          ChannelModel.update(
            {
              hasChanges: true,
            },
            {
              transaction,
              where: {id: channelIds},
            },
          ),
        ]);
      },
    );
  }

  async getExistsYtPubSubVideoIds(ids: string[]) {
    const items: Pick<YtPubSubModel, 'videoId'>[] = await YtPubSubModel.findAll({
      where: {videoId: ids},
      attributes: ['videoId'],
    });
    return items.map((item) => item.videoId);
  }

  cleanYtPubSub() {
    const date = new Date();
    date.setDate(date.getDate() - appConfig.cleanPubSubFeedIfPushOlderThanDays);
    return YtPubSubModel.destroy({
      where: {
        lastPushAt: {[Op.lt]: date},
      },
    });
  }

  async getExistsVideoIds(ids: string[]) {
    const videos: Pick<VideoModel, 'id'>[] = await VideoModel.findAll({
      where: {id: ids},
      attributes: ['id'],
    });
    return videos.map((video) => video.id);
  }

  async getNoExistsVideoIds(ids: string[]) {
    const results = await this.getExistsVideoIds(ids);
    return arrayDifference(ids, results);
  }

  async getChatIdChannelIdByChannelIds(channelIds: string[]) {
    const results = await ChatIdChannelIdModel.findAll({
      where: {channelId: channelIds},
      include: [
        {
          model: ChatModel,
          attributes: ['id', 'channelId', 'isMuted', 'isSkipShortVideos'],
          required: true,
        },
      ],
    });
    return results.map((result) => {
      const {chat} = result;
      if (!chat) {
        throw new Error('Chat association was not loaded');
      }
      return Object.assign(result, {chat});
    });
  }

  cleanVideos() {
    const date = new Date();
    date.setDate(date.getDate() - appConfig.cleanVideosIfPublishedOlderThanDays);
    return Promise.all([
      VideoModel.destroy({
        where: {
          publishedAt: {[Op.lt]: date},
        },
      }),
    ]);
  }

  putVideos(
    channelsChanges: NewChannel[],
    videos: NewVideo[],
    chatIdVideoIdChanges: NewChatIdVideoId[],
  ) {
    let retry = 3;

    const doTry = (): Promise<void> => {
      return this.sequelize
        .transaction(
          {
            isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
          },
          async (transaction) => {
            await Promise.all([
              bulk(channelsChanges, (channelsChanges) => {
                return ChannelModel.bulkCreate(channelsChanges, {
                  updateOnDuplicate: [
                    'lastSyncAt',
                    'lastFullSyncAt',
                    'lastVideoPublishedAt',
                    'title',
                  ],
                  transaction,
                });
              }),
              bulk(videos, (videos) => {
                return VideoModel.bulkCreate(videos, {
                  transaction,
                });
              }),
            ]);

            await bulk(chatIdVideoIdChanges, (chatIdVideoIdChanges) => {
              return ChatIdVideoIdModel.bulkCreate(chatIdVideoIdChanges, {
                transaction,
              });
            });
          },
        )
        .catch((err) => {
          if (isDatabaseDeadlock(err) && --retry > 0) {
            const delay = 250 * 2 ** (2 - retry) + Math.random() * 100;
            return new Promise((resolve) => setTimeout(resolve, delay)).then(() => doTry());
          }
          throw err;
        });
    };

    return doTry();
  }

  async getDistinctChatIdVideoIdChatIds() {
    const now = new Date();
    const chats = await ChatModel.findAll({
      include: [
        {
          model: ChatIdVideoIdModel,
          required: true,
          attributes: [],
        },
      ],
      where: {
        sendTimeoutExpiresAt: {[Op.lt]: now},
      },
      attributes: ['id'],
    });
    return chats.map(({id}) => id);
  }

  async getVideoIdsByChatId(chatId: string, limit = 10) {
    const results: Pick<ChatIdVideoIdModel, 'videoId'>[] = await ChatIdVideoIdModel.findAll({
      where: {chatId},
      include: [
        {
          model: VideoModel,
          attributes: ['publishedAt'],
          required: true,
        },
      ],
      order: [Sequelize.literal('video.publishedAt')],
      attributes: ['videoId'],
      limit: limit,
    });
    return results.map((chatIdVideoId) => chatIdVideoId.videoId);
  }

  async getVideoWithChannelById(id: string) {
    const video = await VideoModel.findOne({
      where: {id},
      include: [{model: ChannelModel, required: true}],
    });
    if (!video) {
      throw new ErrorWithCode('Video is not found', 'VIDEO_IS_NOT_FOUND');
    }
    const {channel} = video;
    if (!channel) {
      throw new Error('Video channel association was not loaded');
    }
    return Object.assign(video, {channel});
  }

  deleteChatIdVideoId(chatId: string, videoId: string) {
    return ChatIdVideoIdModel.destroy({
      where: {chatId, videoId},
    });
  }
}

function bulk<T, F>(results: T[], callback: (results: T[]) => F): Promise<F[]> {
  const resultsParts = arrayByPart(results, 100);
  return Promise.all(resultsParts.map((results) => callback(results)));
}

function dateToSql(date: Date) {
  const [YYYY, MM, DD, HH, mm, ss] = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ].map((v) => (v < 10 ? '0' : '') + v);
  return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;
}

export default Db;
