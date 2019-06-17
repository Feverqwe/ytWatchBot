const debug = require('debug')('app:db');
const Sequelize = require('sequelize');

class Db {
  constructor(/**Main*/main) {
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

    const Channels = this.sequelize.define('channels', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      service: {type: Sequelize.STRING(191), allowNull: false},
      title: {type: Sequelize.TEXT, allowNull: true},
      url: {type: Sequelize.TEXT, allowNull: false},
      publishedAfter: {type: Sequelize.TEXT, allowNull: true},
      subscribeExpire: {type: Sequelize.INTEGER, allowNull: true, defaultValue: 0},
    }, {
      timestamps: false,
      indexes: [{
        name: 'id_UNIQUE',
        unique: true,
        fields: ['id']
      }, {
        name: 'service_idx',
        fields: ['service']
      },]
    });

    const Chats = this.sequelize.define('chats', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: true},
      options: {type: Sequelize.TEXT, allowNull: false},
      insertTime: {type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW},
    }, {
      timestamps: false,
      indexes: [{
        name: 'id_UNIQUE',
        unique: true,
        fields: ['id']
      }, {
        name: 'channelId_UNIQUE',
        unique: true,
        fields: ['channelId']
      },]
    });

    const ChatIdChannelId = this.sequelize.define('chatIdChannelId', {
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      insertTime: {type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW},
    }, {
      timestamps: false,
      indexes: [{
        name: 'chatId_idx',
        fields: ['chatId']
      }, {
        name: 'chatIdChannelId_UNIQUE',
        unique: true,
        fields: ['chatId', 'channelId']
      }]
    });
    ChatIdChannelId.belongsTo(Chats, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdChannelId.belongsTo(Channels, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    const Messages = this.sequelize.define('messages', {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      publishedAt: {type: Sequelize.STRING(191), allowNull: false},
      data: {type: Sequelize.TEXT, allowNull: false},
      imageFileId: {type: Sequelize.TEXT, allowNull: true},
    }, {
      timestamps: false,
      indexes: [{
        name: 'publishedAt_idx',
        fields: ['publishedAt']
      }, {
        name: 'id_UNIQUE',
        unique: true,
        fields: ['id']
      }]
    });
    Messages.belongsTo(Channels, {foreignKey: 'channelId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    const ChatIdMessageId = this.sequelize.define('chatIdMessageId', {
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      messageId: {type: Sequelize.STRING(191), allowNull: false},
      timeout: {type: Sequelize.INTEGER, allowNull: true, defaultValue: 0},
    }, {
      timestamps: false,
      indexes: [{
        name: 'chatIdMessageId_UNIQUE',
        unique: true,
        fields: ['chatId', 'messageId']
      }]
    });
    ChatIdMessageId.belongsTo(Chats, {foreignKey: 'chatId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});
    ChatIdMessageId.belongsTo(Messages, {foreignKey: 'messageId', targetKey: 'id', onUpdate: 'CASCADE', onDelete: 'CASCADE'});

    this.models = {
      Channels,
      Chats,
      ChatIdChannelId,
      Messages,
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
}

export default Db;