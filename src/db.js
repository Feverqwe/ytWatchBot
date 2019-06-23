import ErrorWithCode from "./tools/errorWithCode";

const debug = require('debug')('app:db');
const Sequelize = require('sequelize');

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
      lastVideoPublishedAt: {type: Sequelize.DATE, allowNull: true},
      subscriptionExpiresAt: {type: Sequelize.DATE, allowNull: false, defaultValue: 0},
    }, {
      getterMethods: {
        rawId() {
          return this.getDataValue('id').substr(3);
        }
      },
      setterMethods: {
        rawId(value) {
          const result = Channel.buildId(this.getDataValue('service'), JSON.stringify(value));
          this.setDataValue('id', result);
        }
      },
      indexes: [{
        name: 'service_idx',
        fields: ['service']
      }]
    });
    Channel.buildId = (service, serviceId) => {
      return [service.substr(0, 2), JSON.stringify(serviceId)].join(':');
    };

    const ChatIdChannelId = this.sequelize.define('chatIdChannelId', {
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
    }, {
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
        name: 'chatIdChannelId_UNIQUE',
        unique: true,
        fields: ['chatId', 'channelId']
      }]
    });
    ChatIdChannelId.belongsTo(Chat, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdChannelId.belongsTo(Channel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    const Message = this.sequelize.define('messages', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      publishedAt: {type: Sequelize.STRING(191), allowNull: false},
      data: {type: Sequelize.TEXT, allowNull: false},
      imageFileId: {type: Sequelize.TEXT, allowNull: true},
    }, {
      indexes: [{
        name: 'publishedAt_idx',
        fields: ['publishedAt']
      }]
    });
    Message.belongsTo(Channel, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    const ChatIdMessageId = this.sequelize.define('chatIdMessageId', {
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      messageId: {type: Sequelize.STRING(191), allowNull: false},
      timeout: {type: Sequelize.INTEGER, allowNull: true, defaultValue: 0},
    }, {
      indexes: [{
        name: 'chatIdMessageId_UNIQUE',
        unique: true,
        fields: ['chatId', 'messageId']
      }]
    });
    ChatIdMessageId.belongsTo(Chat, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdMessageId.belongsTo(Message, {foreignKey: 'messageId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    this.model = {
      Channel,
      Chat,
      ChatIdChannelId,
      Message,
      ChatIdMessageId,
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

  getChatById(id) {
    return this.model.Chat.findByPk(id).then((chat) => {
      if (!chat) {
        throw new ErrorWithCode('Chat is not found', 'CHAT_IS_NOT_FOUND');
      }
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
        {model: this.model.Channel}
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
}

export default Db;