import ErrorWithCode from "./tools/errorWithCode";
import arrayByPart from "./tools/arrayByPart";
import serviceId from "./tools/serviceId";
import arrayDifference from "./tools/arrayDifference";

const debug = require('debug')('app:db');
const Sequelize = require('sequelize');
const {Op} = Sequelize;
const ISOLATION_LEVELS = Sequelize.Transaction.ISOLATION_LEVELS;

class Db {
  constructor(/**Main*/main) {
    this.main = main;
    this.sequelize = new Sequelize(main.config.db.database, main.config.db.user, main.config.db.password, {
      host: main.config.db.host,
      port: main.config.db.port,
      dialect: 'mysql',
      omitNull: true,
      logging: false,
      define: {
        charset: 'utf8mb4',
        dialectOptions: {
          charset: 'utf8mb4',
          collate: 'utf8mb4_general_ci'
        }
      },
      pool: {
        max: 50,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    });

    const Chat = this.sequelize.define('chat', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: true},
      isHidePreview: {type: Sequelize.BOOLEAN, defaultValue: false},
      isMuted: {type: Sequelize.BOOLEAN, defaultValue: false},
      sendTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      parentChatId: {type: Sequelize.STRING(191), allowNull: true},
    }, {
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
    Chat.belongsTo(Chat, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'SET NULL', as: 'channel'});
    Chat.belongsTo(Chat, {foreignKey: 'parentChatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE', as: 'parentChat'});

    const Channel = this.sequelize.define('channel', {
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
      tableName: 'channels',
      timestamps: true,
      indexes: [{
        name: 'hasChanges_idx',
        fields: ['hasChanges']
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

    const YtPubSub = this.sequelize.define('ytPubSub', {
      videoId: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: true, defaultValue: null},
      publishedAt: {type: Sequelize.DATE, allowNull: true, defaultValue: null},
      lastPushAt: {type: Sequelize.DATE, allowNull: false},
    }, {
      timestamps: true,
      updatedAt: false,
      indexes: [{
        name: 'lastPushAt_idx',
        fields: ['lastPushAt']
      }]
    });

    const ChatIdChannelId = this.sequelize.define('chatIdChannelId', {
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
    }, {
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
    ChatIdChannelId.belongsTo(Chat, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdChannelId.belongsTo(Channel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    const Video = this.sequelize.define('video', {
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
      tableName: 'videos',
      timestamps: true,
      updatedAt: false,
      indexes: [{
        name: 'publishedAt_idx',
        fields: ['publishedAt']
      }]
    });
    Video.belongsTo(Channel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    const ChatIdVideoId = this.sequelize.define('chatIdVideoId', {
      id: {type: Sequelize.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true},
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      videoId: {type: Sequelize.STRING(191), allowNull: false},
    }, {
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
    ChatIdVideoId.belongsTo(Chat, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdVideoId.belongsTo(Video, {foreignKey: 'videoId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    this.model = {
      Channel,
      Chat,
      ChatIdChannelId,
      Video,
      ChatIdVideoId,
      YtPubSub,
    };
  }

  /**
   * @return {Promise}
   */
  init() {
    return this.sequelize.authenticate().then(() => {
      return this.sequelize.sync();
    });
  }

  ensureChat(id) {
    return this.model.Chat.findOrCreate({
      where: {id},
      include: [
        {model: this.model.Chat, as: 'channel'}
      ]
    }).then(([model, isCreated]) => {
      return model;
    });
  }

  createChatChannel(chatId, channelId) {
    return this.sequelize.transaction({
      isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
    }, async (transaction) => {
      await this.model.Chat.create({
        id: channelId,
        parentChatId: chatId,
      }, {
        transaction
      });
      await this.model.Chat.upsert({
        id: chatId,
        channelId: channelId
      }, {
        transaction
      })
    });
  }

  changeChatId(id, newId) {
    return this.model.Chat.update({id: newId}, {
      where: {id}
    });
  }

  getChatIds(offset, limit) {
    return this.model.Chat.findAll({
      offset,
      limit,
      attributes: ['id']
    }).then((chats) => {
      return chats.map(chat => chat.id);
    });
  }

  getChatById(id) {
    return this.model.Chat.findByPk(id).then((chat) => {
      if (!chat) {
        throw new ErrorWithCode('Chat is not found', 'CHAT_IS_NOT_FOUND');
      }
      return chat;
    });
  }

  getChatsByIds(ids) {
    return this.model.Chat.findAll({
      where: {id: ids},
    });
  }

  setChatSendTimeoutExpiresAt(ids) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.main.config.chatSendTimeoutMinutes);
    return this.model.Chat.update({sendTimeoutExpiresAt: date}, {
      where: {id: ids}
    });
  }

  deleteChatById(id) {
    return this.model.Chat.destroy({
      where: {id}
    });
  }

  deleteChatsByIds(ids) {
    return this.model.Chat.destroy({
      where: {id: ids}
    });
  }

  cleanChats() {
    return this.model.Chat.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT chatId FROM chatIdChannelId)`)},
        parentChatId: null
      }
    });
  }

  ensureChannel(service, rawChannel) {
    const id = serviceId.wrap(service, rawChannel.id);

    return this.model.Channel.findOrCreate({
      where: {id},
      defaults: Object.assign({}, rawChannel, {id, service: service.id})
    }).then(([channel, isCreated]) => {
      return channel;
    });
  }

  getChatIdChannelIdChatIdCount() {
    return this.sequelize.query(`
      SELECT COUNT(DISTINCT(chatId)) as chatCount FROM chatIdChannelId
    `, {type: Sequelize.QueryTypes.SELECT}).then((result) => {
      return result.chatCount;
    });
  }

  getChatIdChannelIdChannelIdCount() {
    return this.sequelize.query(`
      SELECT COUNT(DISTINCT(channelId)) as channelCount FROM chatIdChannelId
    `, {type: Sequelize.QueryTypes.SELECT}).then((result) => {
      return result.channelCount;
    });
  }

  getChatIdChannelIdTop10() {
    return this.sequelize.query(`
      SELECT channelId, COUNT(chatId) as chatCount, channels.service as service, channels.title as title FROM chatIdChannelId
      INNER JOIN channels ON channelId = channels.id
      GROUP BY channelId, channels.service ORDER BY COUNT(chatId) DESC LIMIT 10
    `, {type: Sequelize.QueryTypes.SELECT});
  }

  getChannelsByChatId(chatId) {
    return this.model.ChatIdChannelId.findAll({
      include: [
        {model: this.model.Channel, required: true}
      ],
      where: {chatId},
      attributes: [],
      order: ['createdAt'],
    }).then((chatIdChannelIdList) => {
      return chatIdChannelIdList.map(chatIdChannelId => chatIdChannelId.channel);
    });
  }

  getChannelsByIds(ids) {
    return this.model.Channel.findAll({
      where: {id: ids}
    });
  }

  getChannelById(id) {
    return this.model.Channel.findByPk(id).then((channel) => {
      if (!channel) {
        throw new ErrorWithCode('Channel is not found', 'CHANNEL_IS_NOT_FOUND');
      }
      return channel;
    });
  }

  getChannelCountByChatId(chatId) {
    return this.model.ChatIdChannelId.count({
      where: {chatId}
    });
  }

  putChatIdChannelId(chatId, channelId) {
    return this.model.ChatIdChannelId.upsert({chatId, channelId});
  }

  deleteChatIdChannelId(chatId, channelId) {
    return this.model.ChatIdChannelId.destroy({
      where: {chatId, channelId}
    });
  }

  getChannelsWithExpiresSubscription(limit) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.main.config.updateChannelPubSubSubscribeIfExpiresLessThenMinutes);
    return this.model.Channel.findAll({
      where: {
        subscriptionExpiresAt: {[Op.lt]: date},
        subscriptionTimeoutExpiresAt: {[Op.lt]: new Date()}
      },
      limit: limit
    });
  }

  getChannelsForSync(limit) {
    const date = new Date();
    date.setHours(date.getHours() - this.main.config.checkChannelIfLastSyncLessThenHours);
    return this.model.Channel.findAll({
      where: {
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
        [Op.or]: [
          {hasChanges: true},
          {lastSyncAt: {[Op.lt]: date}}
        ],
      },
      limit: limit
    });
  }

  getChannelIdsByServiceId(service, offset, limit) {
    return this.model.Channel.findAll({
      where: {service},
      attributes: ['id'],
      offset, limit,
    }).then((channels) => {
      return channels.map(channel => channel.id);
    });
  }

  setChannelsSyncTimeoutExpiresAtAndUncheckChanges(ids) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.main.config.channelSyncTimeoutMinutes);
    return this.model.Channel.update({
      syncTimeoutExpiresAt: date,
      hasChanges: false
    }, {
      where: {id: ids}
    });
  }

  setChannelsSubscriptionExpiresAt(ids, expiresAt) {
    return this.model.Channel.update({subscriptionExpiresAt: expiresAt}, {
      where: {id: ids}
    });
  }

  setChannelsSubscriptionTimeoutExpiresAt(ids) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + this.main.config.channelPubSubSubscribeTimeoutMinutes);
    return this.model.Channel.update({subscriptionTimeoutExpiresAt: date}, {
      where: {id: ids}
    });
  }

  removeChannelByIds(ids) {
    return this.model.Channel.destroy({where: {id: ids}});
  }

  cleanChannels() {
    return this.model.Channel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT channelId FROM chatIdChannelId)`)}
      }
    });
  }

  putYtPubSub(feeds, channelsChanges, channelIds) {
    return this.sequelize.transaction({
      isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
    }, async (transaction) => {
      await Promise.all([
        bulk(feeds, (feeds) => {
          return this.model.YtPubSub.bulkCreate(feeds, {
            updateOnDuplicate: ['channelId', 'publishedAt', 'lastPushAt'],
            transaction
          });
        }),
        bulk(channelsChanges, (channelsChanges) => {
          return this.model.Channel.bulkCreate(channelsChanges, {
            updateOnDuplicate: ['lastVideoPublishedAt'],
            transaction,
          });
        }),
        this.model.Channel.update({
          hasChanges: true
        }, {
          transaction,
          where: {id: channelIds}
        })
      ]);
    });
  }

  getExistsYtPubSubVideoIds(ids) {
    return this.model.YtPubSub.findAll({
      where: {videoId: ids},
      attributes: ['videoId']
    }).then((items) => {
      return items.map(item => item.videoId);
    });
  }

  cleanYtPubSub() {
    const date = new Date();
    date.setDate(date.getDate() - this.main.config.cleanPubSubFeedIfPushOlderThanDays);
    return this.model.YtPubSub.destroy({
      where: {
        lastPushAt: {[Op.lt]: date}
      }
    });
  }

  getExistsVideoIds(ids) {
    return this.model.Video.findAll({
      where: {id: ids},
      attributes: ['id']
    }).then((videos) => {
      return videos.map(video => video.id);
    });
  }

  getNoExistsVideoIds(ids) {
    return this.getExistsVideoIds(ids).then((results) => {
      return arrayDifference(ids, results);
    });
  }

  getChatIdChannelIdByChannelIds(channelIds) {
    return this.model.ChatIdChannelId.findAll({
      where: {channelId: channelIds},
      include: [{
        model: this.model.Chat,
        attributes: ['id', 'channelId', 'isMuted'],
        required: true
      }]
    });
  }

  cleanVideos() {
    const date = new Date();
    date.setDate(date.getDate() - this.main.config.cleanVideosIfPublishedOlderThanDays);
    return this.model.Video.destroy({
      where: {
        publishedAt: {[Op.lt]: date}
      }
    });
  }

  putVideos(channelsChanges, videos, chatIdVideoIdChanges) {
    return this.sequelize.transaction({
      isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
    }, async (transaction) => {
      await Promise.all([
        bulk(channelsChanges, (channelsChanges) => {
          return this.model.Channel.bulkCreate(channelsChanges, {
            updateOnDuplicate: ['lastSyncAt', 'lastFullSyncAt', 'lastVideoPublishedAt', 'title'],
            transaction
          });
        }),
        bulk(videos, (videos) => {
          return this.model.Video.bulkCreate(videos, {
            transaction
          });
        }),
      ]);

      await bulk(chatIdVideoIdChanges, (chatIdVideoIdChanges) => {
        return this.model.ChatIdVideoId.bulkCreate(chatIdVideoIdChanges, {
          transaction
        });
      });
    });
  }

  getDistinctChatIdVideoIdChatIds() {
    return this.sequelize.query(`
      SELECT DISTINCT chatId FROM chatIdVideoId
      INNER JOIN chats ON chatIdVideoId.chatId = chats.id
      WHERE chats.sendTimeoutExpiresAt < "${new Date().toISOString()}"
    `,  { type: Sequelize.QueryTypes.SELECT}).then((results) => {
      return results.map(result => result.chatId);
    });
  }

  getVideoIdsByChatId(chatId, limit = 10) {
    return this.model.ChatIdVideoId.findAll({
      where: {chatId},
      include: [{
        model: this.model.Video,
        attributes: ['publishedAt'],
        required: true,
      }],
      order: [Sequelize.literal('video.publishedAt')],
      attributes: ['videoId'],
      limit: limit,
    }).then((results) => {
      return results.map(chatIdVideoId => chatIdVideoId.videoId);
    });
  }

  getVideoWithChannelById(id) {
    return this.model.Video.findOne({
      where: {id},
      include: [
        {model: this.model.Channel, required: true}
      ]
    }).then((video) => {
      if (!video) {
        throw new ErrorWithCode('Video is not found', 'VIDEO_IS_NOT_FOUND');
      }
      return video;
    });
  }

  deleteChatIdVideoId(chatId, videoId) {
    return this.model.ChatIdVideoId.destroy({
      where: {chatId, videoId}
    });
  }
}

function bulk(results, callback) {
  const resultsParts = arrayByPart(results, 100);
  return Promise.all(resultsParts.map(results => callback(results)));
}

export default Db;