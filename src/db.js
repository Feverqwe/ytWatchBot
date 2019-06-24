import ErrorWithCode from "./tools/errorWithCode";

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
        max: 150,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    });

    const Chat = this.sequelize.define('chats', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: true},
      isHidePreview: {type: Sequelize.BOOLEAN, defaultValue: false},
      isMuted: {type: Sequelize.BOOLEAN, defaultValue: false},
    }, {
      timestamps: false,
      indexes: [{
        name: 'channelId_UNIQUE',
        unique: true,
        fields: ['channelId']
      },]
    });

    const Channel = this.sequelize.define('channels', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      service: {type: Sequelize.STRING(191), allowNull: false},
      name: {type: Sequelize.TEXT, allowNull: true},
      url: {type: Sequelize.TEXT, allowNull: false},
      hasChanges: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      lastSyncAt: {type: Sequelize.DATE, allowNull: true},
      syncTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: 0},
      subscriptionExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: 0},
      subscriptionTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: 0},
    }, {
      timestamps: false,
      getterMethods: {
        rawId() {
          const id = this.getDataValue('id');
          if (id) {
            return JSON.parse(id.substr(3));
          }
        }
      },
      setterMethods: {
        rawId(value) {
          const result = Channel.buildId(this.getDataValue('service'), JSON.stringify(value));
          this.setDataValue('id', result);
        }
      },
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
    Channel.buildId = (service, serviceId) => {
      return [service.substr(0, 2), JSON.stringify(serviceId)].join(':');
    };

    const YtPubSub = this.sequelize.define('ytPubSub', {
      videoId: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      lastPushAt: {type: Sequelize.DATE, allowNull: false, primaryKey: true},
    }, {
      timestamps: false,
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
      timestamps: false,
      getterMethods: {
        serviceId() {
          let result = null;
          const shortServiceId = this.getDataValue('channelId').substr(0, 2);
          main.services.some((id) => {
            if (id.substr(0, 2) === shortServiceId) {
              return result = id;
            }
          });
          if (!result) {
            throw new Error(`serviceId is not matched`);
          }
          return result;
        }
      },
      indexes: [{
        name: 'chatId_idx',
        fields: ['chatId']
      }, {
        name: 'channelId_idx',
        fields: ['channelId']
      }, {
        name: 'chatId_channelId_UNIQUE',
        unique: true,
        fields: ['chatId', 'channelId']
      }]
    });
    ChatIdChannelId.belongsTo(Chat, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdChannelId.belongsTo(Channel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    const Video = this.sequelize.define('videos', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      title: {type: Sequelize.STRING(191), allowNull: false},
      previews: {type: Sequelize.JSON, allowNull: false},
      duration: {type: Sequelize.STRING(191), allowNull: true},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      publishedAt: {type: Sequelize.DATE, allowNull: false},
      telegramPreviewFileId: {type: Sequelize.TEXT, allowNull: true},
    }, {
      timestamps: false,
      indexes: [{
        name: 'publishedAt_idx',
        fields: ['publishedAt']
      }]
    });
    Video.belongsTo(Channel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    const ChatIdVideoId = this.sequelize.define('chatIdVideoId', {
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      videoId: {type: Sequelize.STRING(191), allowNull: false},
      sendTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: 0},
    }, {
      tableName: 'chatIdVideoId',
      timestamps: false,
      indexes: [{
        name: 'chatId_videoId_UNIQUE',
        unique: true,
        fields: ['chatId', 'videoId']
      },{
        name: 'sendTimeoutExpiresAt_idx',
        fields: ['sendTimeoutExpiresAt']
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
    return this.model.Chat.findOrBuild({
      where: {id},
      defaults: {id}
    }).then(([chat, isBuilt]) => {
      return chat;
    });
  }

  getChatByChannelId(channelId) {
    return this.model.Chat.findOne({
      where: {channelId}
    }).then((chat) => {
      if (!chat) {
        throw new ErrorWithCode('Chat is not found', 'CHAT_IS_NOT_FOUND');
      }
      return chat;
    });
  }

  deleteChatById(id) {
    return this.model.Chat.destroy({
      where: {id}
    });
  }

  ensureChannel(service, rawChannel) {
    const id = this.model.Channel.buildId(service, rawChannel.id);

    return this.model.Channel.findOrCreate({
      where: {id},
      defaults: Object.assign({}, rawChannel, {id, service})
    }).then(([channel, isCreated]) => {
      return channel;
    });
  }

  getChatIdChannelId() {
    return this.model.ChatIdChannelId.findAll({
      attributes: ['chatId', 'channelId']
    });
  }

  getChannelsByChatId(chatId) {
    return this.model.ChatIdChannelId.findAll({
      include: [
        {model: this.model.Channel, required: true}
      ],
      where: {chatId},
      attributes: [],
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

  putChatIdChannelId(chatId, channelId) {
    return this.model.ChatIdChannelId.upsert({chatId, channelId});
  }

  deleteChatIdChannelId(chatId, channelId) {
    return this.model.ChatIdChannelId.destroy({
      where: {chatId, channelId}
    });
  }

  getChannelsWithExpiresSubscription() {
    const date = new Date();
    date.setMinutes(date.getMinutes() - 30);
    return this.model.Channel.findAll({
      where: {
        subscriptionExpiresAt: {[Op.lt]: date},
        subscriptionTimeoutExpiresAt: {[Op.lt]: new Date()}
      }
    });
  }

  getChannelsForSync() {
    const date = new Date();
    date.setMinutes(date.getMinutes() - this.main.config.interval);
    return this.model.Channel.findAll({
      where: {
        syncTimeoutExpiresAt: {[Op.lt]: new Date()},
        [Op.or]: [
          {hasChanges: true},
          {lastSyncAt: {[Op.or]: [
            null,
            {[Op.lt]: date}
          ]}}
        ],
      }
    });
  }

  setChannelsSyncTimeoutExpiresAt(ids, minutes = 5) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return this.model.Channel.update({syncTimeoutExpiresAt: date}, {
      where: {id: ids}
    });
  }

  setChannelsSubscriptionExpiresAt(ids, expiresAt) {
    return this.model.Channel.update({subscriptionExpiresAt: expiresAt}, {
      where: {id: ids}
    });
  }

  setChannelsSubscriptionTimeoutExpiresAt(ids, minutes = 5) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return this.model.Channel.update({subscriptionTimeoutExpiresAt: date}, {
      where: {id: ids}
    });
  }

  cleanUnusedChannels() {
    return this.model.Channel.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT channelId FROM chatIdChannelId)`)}
      }
    });
  }

  putYtPubSub(existsVideoIds, ytPubSubItems, channelIds) {
    return this.sequelize.transaction({
      isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
    }, async (transaction) => {
      await Promise.all([
        this.model.YtPubSub.bulkCreate(ytPubSubItems, {
          transaction
        }),
        this.model.Channel.update({
          hasChanges: true
        }, {
          transaction,
          where: {id: channelIds}
        }),
        this.model.YtPubSub.update({
          lastPushAt: new Date()
        }, {
          transaction,
          where: {id: existsVideoIds}
        }),
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

  cleanYtPubSubVideoIds() {
    const date = new Date();
    date.setDate(date.getDate() - 7);
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

  getChatIdChannelIdByChannelIds(channelIds) {
    return this.model.ChatIdChannelId.findAll({
      where: {channelId: channelIds}
    });
  }

  putVideos(channelsChanges, videos, chatIdVideoIdChanges) {
    return this.sequelize.transaction({
      isolationLevel: ISOLATION_LEVELS.REPEATABLE_READ,
    }, async (transaction) => {
      await Promise.all([
        this.model.Channel.bulkCreate(channelsChanges, {
          updateOnDuplicate: ['lastSyncAt', 'title'],
          transaction
        }),
        this.model.Video.bulkCreate(videos, {
          transaction
        })
      ]);

      await this.model.ChatIdVideoId.bulkCreate(chatIdVideoIdChanges, {
        transaction
      });
    });
  }
}

export default Db;