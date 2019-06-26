const debug = require('debug')('app:db');
const mysql = require('mysql');
const Sequelize = require('sequelize');

class Db {
  constructor(/**Main*/main) {
    this.config = main.config.db;
    this.connection = null;

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

  init() {
    return this.sequelize.authenticate().then(() => {
      return this.sequelize.sync();
    }).then(() => {
      // legacy
      this.connection = this.getPool();
      return this.getVersion();
    });
  }

  getConnection() {
    return mysql.createConnection({
      host: this.config.host,
      user: this.config.user,
      port: this.config.port,
      password: this.config.password,
      database: this.config.database,
      charset: 'utf8mb4'
    });
  }

  getPool(limit) {
    limit = limit || 1;
    return mysql.createPool({
      connectionLimit: limit,
      host: this.config.host,
      user: this.config.user,
      port: this.config.port,
      password: this.config.password,
      database: this.config.database,
      charset: 'utf8mb4'
    });
  }

  newConnection() {
    var connection = this.getConnection();

    return new Promise(function (resolve, reject) {
      connection.connect(function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(connection);
        }
      });
    });
  }

  transaction(promise) {
    var _this = this;
    return _this.newConnection().then(function (connection) {
      return new Promise(function (resolve, reject) {
        connection.beginTransaction(function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(connection);
          }
        });
      }).then(promise).then(function () {
        return new Promise(function (resolve, reject) {
          connection.commit(function (err) {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      }).catch(function (err) {
        return new Promise(function (resolve) {
          connection.rollback(resolve);
        }).then(function () {
          throw err;
        });
      }).then(function (result) {
        connection.end();
        return result;
      }, function (err) {
        connection.end();
        throw err;
      });
    });
  }

  getVersion() {
    return new Promise((resove, reject) => {
      this.connection.query('SELECT VERSION()', function (err, results) {
        err ? reject(err) : resove(results[0]['VERSION()']);
      });
    });
  }

  wrapTableParams(table, params) {
    return params.map(function (param) {
      return [[table, param].join('.'), 'AS', [table, param].join('_DOT_')].join(' ')
    }).join(', ');
  }

  unWrapTableParams(row) {
    const result = {};
    Object.keys(row).forEach(function (key) {
      const keyValue = /^(.+)_DOT_(.+)$/.exec(key);
      if (!keyValue) {
        result[key] = row[key];
      } else {
        let tableName = keyValue[1];
        let field = keyValue[2];
        let table = result[tableName];
        if (!table) {
          table = result[tableName] = {};
        }
        table[field] = row[key];
      }
    });
    return result;
  }
}

module.exports = Db;