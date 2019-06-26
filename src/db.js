import ErrorWithCode from "./tools/errorWithCode";
import arrayByPart from "./tools/arrayByPart";

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
      lastSyncAt: {type: Sequelize.DATE, allowNull: true},
      syncTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      subscriptionExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      subscriptionTimeoutExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
    }, {
      tableName: 'channels',
      timestamps: true,
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

    const Video = this.sequelize.define('video', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      url: {type: Sequelize.STRING(191), allowNull: false},
      title: {type: Sequelize.STRING(191), allowNull: false},
      previews: {type: Sequelize.JSON, allowNull: false},
      duration: {type: Sequelize.STRING(191), allowNull: true},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      publishedAt: {type: Sequelize.DATE, allowNull: false},
      telegramPreviewFileId: {type: Sequelize.TEXT, allowNull: true},
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

  migrate() {
    const qi = this.sequelize.getQueryInterface();
    return Promise.resolve().then(async () => {
      const oldChats = await this.sequelize.query("SELECT * FROM chats", { type: Sequelize.QueryTypes.SELECT});
      const oldChannels = await this.sequelize.query("SELECT * FROM channels", { type: Sequelize.QueryTypes.SELECT});
      const oldMessages = await this.sequelize.query("SELECT * FROM messages", { type: Sequelize.QueryTypes.SELECT});
      const oldChatIdChannelIdList = await this.sequelize.query("SELECT * FROM chatIdChannelId", { type: Sequelize.QueryTypes.SELECT});
      const oldChatIdMessageIdList = await this.sequelize.query("SELECT * FROM chatIdMessageId", { type: Sequelize.QueryTypes.SELECT});

      await qi.dropTable('chatIdMessageId');
      await qi.dropTable('chatIdChannelId');
      await qi.dropTable('messages');
      await qi.dropTable('channels');
      await qi.dropTable('chats');

      await this.sequelize.sync();

      const chats = [];
      for (const oldChat of oldChats) {
        let options = {};
        try {
          options = JSON.parse(oldChat.optoins);
        } catch (err) {
          // pass
        }

        if (!oldChat.channelId) {
          chats.push({
            id: oldChat.id,
            isHidePreview: !!options.hidePreview,
            isMuted: !!options.mute,
            createdAt: getCreatedAt(oldChat.insertTime)
          });
        } else {
          await this.model.Chat.create({
            id: oldChat.id,
            isHidePreview: !!options.hidePreview,
            isMuted: !!options.mute,
            createdAt: getCreatedAt(oldChat.insertTime)
          });

          await this.model.Chat.create({
            id: oldChat.channelId,
            isHidePreview: !!options.hidePreview,
            parentChatId: oldChat.id,
            createdAt: getCreatedAt(oldChat.insertTime)
          });

          await this.model.Chat.upsert({
            id: oldChat.id,
            channelId: oldChat.channelId,
          });
        }
      }
      await bulk(chats, (chats) => {
        return this.model.Chat.bulkCreate(chats);
      });

      const channels = [];
      for (const oldChannel of oldChannels) {
        let publishedAfter = new Date(oldChannel.publishedAfter);
        if (!publishedAfter.getTime()) {
          publishedAfter = new Date();
        }

        channels.push({
          id: oldChannel.id,
          service: oldChannel.service,
          title: oldChannel.title,
          url: oldChannel.url,
          lastSyncAt: publishedAfter
        });
      }
      await bulk(channels, (channels) => {
        return this.model.Channel.bulkCreate(channels);
      });

      const videos = [];
      for (const oldVideo of oldMessages) {
        const data = JSON.parse(oldVideo.data);

        videos.push({
          id: oldVideo.id,
          url: data.url,
          title: data.title,
          previews: data.preview,
          duration: data.duration,
          channelId: oldVideo.channelId,
          publishedAt: oldVideo.publishedAt,
          telegramPreviewFileId: oldVideo.imageFileId || null
        });
      }
      await bulk(videos, (videos) => {
        return this.model.Video.bulkCreate(videos);
      });

      const chatIdChannelIdList = [];
      for (const oldChatIdChannelId of oldChatIdChannelIdList) {
        chatIdChannelIdList.push({
          chatId: oldChatIdChannelId.chatId,
          channelId: oldChatIdChannelId.channelId,
          createdAt: getCreatedAt(oldChatIdChannelId.insertTime)
        });
      }
      await bulk(chatIdChannelIdList, (chatIdChannelIdList) => {
        return this.model.ChatIdChannelId.bulkCreate(chatIdChannelIdList);
      });

      const chatIdVideoIdList = [];
      for (const oldChatIdVideoId of oldChatIdMessageIdList) {
        chatIdVideoIdList.push({
          chatId: oldChatIdVideoId.chatId,
          videoId: oldChatIdVideoId.messageId
        });
      }
      await bulk(chatIdVideoIdList, (chatIdVideoIdList) => {
        return this.model.ChatIdVideoId.bulkCreate(chatIdVideoIdList);
      });

      debug('Migrate complete!');
      process.exit(0);

      function getCreatedAt(time) {
        let createdAt = null;
        try {
          createdAt = new Date(time);
          if (!createdAt.getTime()) {
            throw new Error('Incorrect time');
          }
        } catch (err) {
          createdAt = new Date();
        }
        return createdAt;
      }
    });
  }

  ensureChat(id) {
    return this.model.Chat.findOne({
      where: {id},
      include: [
        {model: this.model.Chat, as: 'channel'}
      ]
    }).then((chat) => {
      if (!chat) {
        chat = this.model.Chat.build({id});
      }
      return chat;
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

  setChatSendTimeoutExpiresAt(ids, minutes = 5) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return this.model.Chat.update({sendTimeoutExpiresAt: date}, {
      where: {id: ids}
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

  setChannelsSyncTimeoutExpiresAtAndUncheckChanges(ids, minutes = 5) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
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

  setChannelsSubscriptionTimeoutExpiresAt(ids, minutes = 5) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return this.model.Channel.update({subscriptionTimeoutExpiresAt: date}, {
      where: {id: ids}
    });
  }

  cleanChannels() {
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
        bulk(ytPubSubItems, (ytPubSubItems) => {
          return this.model.YtPubSub.bulkCreate(ytPubSubItems, {
            transaction
          });
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
          where: {videoId: existsVideoIds}
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

  cleanYtPubSub() {
    const date = new Date();
    date.setDate(date.getDate() - 30);
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
    date.setDate(date.getDate() - 30);
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
            updateOnDuplicate: ['lastSyncAt', 'title'],
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